# Agent Note: 浏览器载体在非安全上下文下铸造 id

状态:已实现

[English](2026-08-17-insecure-origin-uuid-minting.md) | 中文

## 问题

Web GUI 只能从回环地址启动。经明文 HTTP 从其他任何地址访问——`webserver.host: '0.0.0.0'` 之后的局域网地址、反向代理后的主机——页面能加载,随后应用在启动过程中以 `crypto.randomUUID is not a function` 死亡,没有任何 `/api` 请求到达服务端。

`crypto.randomUUID` 是只在安全上下文中存在的 Web API。浏览器只把 `https:` 源以及 `http://localhost` / `http://127.0.0.0/8` 视为安全上下文,别无例外,所以在 `http://192.168.x.y:3080` 上该方法是 `undefined`,而不受此限制的 `crypto.getRandomValues` 仍然可用。

`AbstractApiClient.mintRpcId()` 调用了它。那是每一个一元 `/api` 调用和每一次 `respond` 共用的唯一铸造点(`WebApiClient` 直接继承),而 `ConnectionController` 的就绪握手正是 `host.describe`,于是第一个连接世代的第一个请求就抛出,客户端还来不及订阅任何东西。输入区的草稿附件 id(`ui-conversation`)有同一个调用。

这套配置下 `/api` 的 Host 围栏本来是满足的:全接口绑定会把本机的 LAN IPv4 字面量派生进 `client-connection` 的 `trustedHosts`,携带 IP 字面量 Host 的请求可以通过。可达性与信任都正确,客户端只是铸不出 id。因此 `dsh web --host 0.0.0.0` 与启动行宣传的 LAN URL 从浏览器根本用不了,这正是社区报告 [#221](https://github.com/deepseek-ai/deepseek-harness/discussions/221) 与 [#514](https://github.com/deepseek-ai/deepseek-harness/discussions/514) 描述的现象。

其中一条铸造路径本来已经正确。`packages/client/connection/src/client/rpc.ts` 通过一个包内私有、基于 `getRandomValues` 的 `randomUuid()` 铸造,那是为通用 Connection 通道加的。正是它的存在让这次失败看起来像配置问题:一部分流量铸造正常,而启动应用的那个载体不行。

## 决定

一个 `randomUuid()` 服务所有浏览器载体,它落在 apiproxy 的 `api/` 层——该层写明的契约就是"零 Node 依赖,可从浏览器导入"。`AbstractApiClient.mintRpcId()`、connection 的通道调用方、fixture 载体、输入区草稿附件全部经它铸造;`packages/client/connection/src/client/random-uuid.ts` 删除,于是 monorepo 中只留一份。

由 `api/` 而非某个 client 包持有,是因为依赖方向是 `client/connection` → `host/apiproxy`:铸造器必须位于最低层消费者之下或与之同层,而 `AbstractApiClient` 本身就定义在 apiproxy 里。Client bundle 以值导入方式取用,这个 specifier 家族本就被纯度门禁允许(`packages/client/tsdown.client.ts` 中的 `INLINE_SAFE`)——按 bundle 内联一层 wire 层正是预期形态,所以没有改动任何允许清单。

`dsh-brand` 是另一个所有消费者都已依赖的候选,被否决:它写明是仅类型包、不携带运行时代码,而一次 CSPRNG 调用恰恰是它排除的那种运行时。

构造方式与被替换的助手完全一致——16 个随机字节、覆写版本 4 与变体半字节、格式化为十六进制——所以 id 仍是 RFC 4122 version 4 且仍由 CSPRNG 支撑。任何地方都没有退化到 `Math.random()`:用于把请求与响应关联起来的 id 没有理由可预测,而在非安全上下文中存活下来的那个原语本身已经是 CSPRNG。

## 考虑过的替代方案

- **新建 `packages/util/random-uuid` 包。** 语义上最干净的归属,也是唯一还能同时服务 `dsh-llm` 的方案(见"影响")。本次修复否决它:为了搬七行代码,要付出一个包的全套机构——manifest、tsconfig face、双语 README、invariant 条目、覆盖率、hygiene 与目录重新生成——而且那是"零依赖运行时工具该放哪"的决定,不是这个缺陷的决定。若将来第三个平面也需要这个铸造器,它仍是应走的一步。
- **每个包各留一份私有副本。** 同一个七行函数三份副本,重复检测门禁在 `minTokens: 60` 处以失败退出码拒绝,而且下一次同类修复要改三遍。
- **把铸造器放进 `dsh-llm`。** 机械上覆盖面最广——apiproxy 已经依赖它,其子路径也是 inline-safe——但那会把一个 UUID 铸造器塞进 LLM 能力包,而该包持有的是消息与流的词汇,与此无关。
- **在 shell 启动时 polyfill `crypto.randomUUID`。** 一次赋值覆盖现在和将来所有调用点,包括本仓库不拥有的代码。否决,因为它篡改了一个平台全局,而该方法的缺失是浏览器有意发出的信号;它还把这个约束藏了起来,而不是写在铸造 id 的地方。
- **改用 TLS 提供 GUI。** 这是真实部署层面的答案,也能一并修好剪贴板等其他安全上下文 API,但它会让一个无认证载体的可达性取决于证书签发,而且这个 bug 是浏览器 API 的误用,与传输方式无关。

## 影响

`dsh web` 在全接口绑定下可从浏览器使用:就绪握手、所有一元调用、下行升级、图片附件都能在非安全上下文中铸造 id。回环行为不变,因为 `getRandomValues` 在那里同样可用,且 id 格式完全相同。

特权方法的钉定未受触碰,仍决定非回环客户端能做什么:`settings.*`、`credentials.*`、`llm.discoverModels`、`host.pickDirectory`/`openPath` 以及 agent-preset 的编写类方法对 LAN Host 一律回 403,所以远程浏览器可以对话、可以跑工具,但不能重新配置这套部署。这次修复移除的是一次崩溃,不是那条边界,也没有加入认证——非回环绑定依然信任它所在的网络。

有一个调用点是刻意留下的:`packages/llm/llm/src/message.ts` 的 `createMessage()` 仍使用 `crypto.randomUUID`。它只通过 `packages/client/connection/src/client/fixture.ts`(供脱离服务端做 UI 开发的假载体)到达浏览器,因此仅在 fixture 模式下会在非安全上下文中抛出。它无法导入本次的助手——`host/apiproxy` 依赖 `dsh-llm`,反向边会成环——在那里复制一份又会触发重复检测门禁。修好它需要上面权衡过的 util 包;在那之前,fixture 模式需要回环源。

## 测试

`packages/host/apiproxy/tests/fetch-carrier.spec.ts` 在铸造点上钉住该缺陷:把 `crypto` 打桩到只剩 `getRandomValues`——即非安全上下文的环境——一次一元调用可以完成,且观察到的信封携带 `00000000-0000-4000-8000-000000000000`,这个全零随机性下确定性的 UUID 的版本与变体半字节证明那些位仍被设置。第二个用例断言真实随机性产出互不相同的 version-4 id。修复之前第一个用例抛出 `crypto.randomUUID is not a function`,即在门禁下复现了所报告的失败。

通用通道既有的非安全上下文断言(`packages/client/connection/tests/client-apply.client.spec.ts`)未作改动,经共享助手仍然通过,这说明删除包内私有副本保住了那条路径。`packages/client/connection` 与 `packages/client/ui-conversation` 两个测试套件原样通过。

没有快照发生变化。现有 transcript 与 web golden 记录的是回环下已启动的应用,那正是它们原本运行的配置;本次修复恢复的行为只在非回环源下出现,而无密钥 fixture 不提供这种源。要端到端复现它需要第二台主机上的真实浏览器,而组装应用的测试设施目前没有这条通道——这是一个明确记录的缺口,也是单元断言钉住环境而非钉住部署的原因。
