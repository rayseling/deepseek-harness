# Agent Note: 被描述的设置值按 fail-closed 脱敏

Status: implemented

[English](2026-08-17-fail-closed-secret-redaction.md) | 中文

## 问题

`redactSecrets` 只走 `object`、`dict` 与 `array`，其 `default:` 分支把值原样返回。因此一个只能经由 `union`、`intersect`、`transform` 或 `tuple` 抵达的 `role('secret')` 会完整跨过协议边界，`secrets` 列表为空，也没有任何东西记录这次遗漏——settings 的 README 点明了这一点，并把 fail-closed 的 `describeForWire()` 称为真正的答案、列为延期。

第二条路径根本不需要「走不进去的容器」也会泄漏：`dsh-llm-pi-ai` 的 profile `headers` 是 `z.dict(z.string())`，所以操作者把 `Authorization: Bearer …` 或 `api-key` 存在那里，脱敏后的 `describe()` 会把它返回，配置界面还会渲染出来。walker 对 dict 的下降是正确的；只是根本没有 secret role 可找，因为 header 的值本身没有任何信息说明它是一条凭据。

在配置面只答复回环 Host 的时候，这两者都还可以容忍。而把该平面的授权范围变为可配置（[配置面按需跟随 trustedHosts](2026-08-17-configuration-plane-authority.md)）之后，两者都变成了网络可达的凭据读取，而且前面放一层做认证的代理也修不了一份自身就携带密钥的响应。

## 决定

walker 对自己无法下降的东西 fail closed。它的 `default:` 分支现在会追问：该节点的子树里是否任何位置存在 secret role——沿着全部嵌套关系（`inner`、`list`、`dict`）查找；若存在，该子树从值中扣下，其路径记录进新增的 `unprovable` 列表。标量叶子仍照原样返回，不含 secret 的分支集合同样如此——判据是子树的内容而不是节点的类型，因为字面量枚举正是最常见的 `union`，按类型 fail closed 会扣下大部分配置。

`tuple` 加入了 README 点名的那三种容器。它有同样的缺口，原因也相同：walker 从未下降过 `list`。另有两个位置就同一个问题 fail closed。`lazy` 的子节点位于它的 `builder` 之后，因此会调用该工厂来追问其下是否藏着 secret——schemastery 的 schema 是可调用的，所以结果读出来是 `function` 而不是 `object`，而一个抛异常的 builder 按「藏有 secret」计。以及本该是容器的位置上出现的畸形值（dict 的位置给了字符串）会被扣下而不是原样放行，因为 walker 无法定位其中的 secret 位置；同样的值若所属 schema 里没有任何 secret 则仍然放行，正是这一点让普通的畸形配置对那个需要修正它的表单保持可见。

序列化后的 schema 同样是一份上线的值。`sanitizeSchemaEnvelope` 会分离 `schema.toJSON()`，并从每个 `role: 'secret'` 的 ref 上删除 `default` 与 `initial`；`describe` 在脱敏时应用它，于是 secret 字段声明的默认值不再越过值脱敏随信封上线。信封的 `refs` 表是扁平的，这正是它能覆盖到值 walker 到不了的那些 secret 节点的原因：埋在 union 分支里的节点仍然是它自己的一条 ref。

`dict` 的键 schema 同样是一条嵌套关系（`sKey`），而其上的 secret role 意味着**键名本身**就是机密。它们不能进 `secrets`——那份附带清单里的每一条都会写出自己的路径，列出它们恰好会公开本该藏起来的东西——因此整个 dict 被扣下，只报出它自身的位置。

包含性搜索是环安全的，因为 `z.lazy` 正是递归 schema 的写法，若不然调用它的 builder 会把环无限展开。重访一个节点不贡献任何结论，因此环本身永远不会让一棵子树成为「藏有机密」；只有真正找到的 secret role 才会。对于每次调用都返回一棵全新树、因而没有可检测的重复身份的 builder，还有一个深度上界兜底：耗尽它就回答「这里可能藏着机密」，从而不让 Host 卡在一个它分析不完的协议请求上。

`unprovable` 是被发布出去的，而不是算完就丢：它随 `SettingsDescriptor` 与 wire 视图 `SettingsNamespaceView` 一起出去，为空时省略。真正拒绝它的是客户端——`SettingsScopeController` 会把这样的 namespace 发布为 `unavailable` 且只读，并拒绝对它的写入，因此没有任何表单会去编辑一份由不完整读取拼出的值。

`headers` 在协议上变为只写：其元素带 `role('secret')`，所以脱敏后的 `describe()` 扣下每一个值，而键名走 `secrets` 附带清单——正是这一点让表单能为每个 header 渲染只写输入框。真实请求继续使用真实值，只有被描述的视图被剥离。`apiKeyEnv` 的引用名保持可读，因为引用名不是凭据。

## 考虑过的替代方案

- **脱敏无法被证明时拒绝整个 namespace。** 这是 README 自己的表述，也是更好的产品答案：带着一个无声窟窿被端出去的 namespace 令人困惑。但它需要一个协议字段和一种 UI 状态来解释这次拒绝，那比堵住泄漏是更大的改动；`unprovable` 被公开出来，正是为了让那项工作不必重做这份分析。
- **按节点类型 fail closed**（任何 `union`/`intersect`/`transform`/`tuple`）。否决：字符串字面量枚举就是 union，这么做会扣下几乎每一个配置页的大部分内容，而并未多保护任何东西。
- **保持 walker 原样，仅以约定禁止这类 schema。** 这是现状，也是 README 对注册方的要求。约定不是强制——没有任何东西会拒绝一个违反它的 schema，而失败形态是一次无声的凭据读取。
- **只拒绝看起来像凭据的 header 名**（`Authorization`、`api-key`、`x-api-key`）。否决：这张名单在下一个厂商的 header 名上就是错的，而它没能保护的那个值，恰恰就是没人记得加进名单的那个。
- **在配置期拒绝看起来像凭据的 `headers` 条目。** 同样脆弱，而且会拒绝一套网关确实需要静态 header 的正当部署。

## 影响

被描述的设置值不可能再携带一条脱敏器没有交代的 `role('secret')`：它要么被移除并列入 `secrets`，要么其子树被扣下、位置报进 `unprovable`。这对回环调用方同样成立——无论是哪个授权提供的页面，浏览器页面都是一条协议边界。

配置界面不再显示某个 pi-ai 提供方已有的 header 值，而是为每个键显示只写输入框。曾把凭据存进 `headers` 的操作者，路由照常工作，而那条凭据不再能从页面上读到。要让表单显示一条凭据的名字，`apiKeyEnv` 仍是那个办法。

`RedactedValue` 新增了必填成员 `unprovable`，因此每个解构该结果的调用方都会看到它。拒绝发生在客户端而不是 Host：`describe` 仍会答复一个携带 `unprovable` 的 namespace，是 scope 控制器让它不可编辑。一个根本不提供这类 namespace、并净化错误文本的 Host 侧 `describeForWire()`，仍是更完整的答案，属于延期项。

有一条通道在构造上仍然开着，并已记入 settings 的 README：schema 未声明的键会原样上线，因为对象 walker 会保留 schema 之外的键，而 schema 从未建模过的东西无从分类。凭据应当落在已声明 `role('secret')` 的字段上，或藏在 `apiKeyEnv` 这类引用之后。

## 测试

`packages/settings/settings/tests/redact.spec.ts` 对两种走不进去的形态都证明了扣下：藏在某个 `union` 分支里的 secret、以及位于 `transform` 之下的 secret，都不出现在值里——断言方式是在序列化后的值里搜索那个真实字符串，而不只是比对结构——并且各自把路径报进 `unprovable`。配套用例钉住让这个判据值得存在的非回归：一个字面量枚举 `union` 与一个普通数字并列时原样返回，`secrets` 与 `unprovable` 都为空。

递归的 `z.lazy` schema 在两个方向上都有覆盖——带机密的那个会被扣下并报出位置，且不耗尽调用栈；仅仅递归的那个照常返回它的值；而键 schema 声明了机密的 `dict` 会被扣下，键名既不出现在值里、也不出现在 `secrets` 里，普通键 schema 则让该 dict 保持可读。

另有两个用例覆盖第一轮之后才发现的位置：藏在 `lazy` builder 之后的 secret 会被扣下，而其下没有任何 secret 的 `lazy` schema 仍然返回它的值；带 secret 的容器下的畸形值会被扣下并报出两条路径，而同样的畸形若所属 schema 不含 secret 则原样通过。descriptor 层面的用例钉住信封与被发布的成员：脱敏后 describe 的序列化 schema 里不含 secret 的 `.default(...)`（包括声明在某个 union 分支内部的那一个），而普通字段的默认值仍在；未脱敏的内部读取仍然带着它；secret 位于 union 之下的 namespace 会报出 `unprovable`，而干净的 namespace 省略该成员。

`headers` 的保证是对着真实 schema 而非夹具证明的：用 `dsh-llm-pi-ai` 导出的 `Config` 组合出一个 `headers` 含 `Authorization` 与普通 `X-Org` 条目的提供方，脱敏后的 `describe` 值里两个字符串都不存在，而附带清单列出了两个键的路径。

组装后的应用在 `apps/web/tests/remote-configuration-plane.e2e.ts` 中闭合这条回路：一条经 shipped settings provider 自身写入路径植入的 canary 凭据，必须同时不出现在 `settings.describe` 的响应体与真实设置对话框渲染出的 DOM 里，而该提供方的公开邻居字段、它的 `apiKeyEnv` 引用名、以及附带清单里的 secret 槽位都必须在场——因此那条「不存在」的断言不可能空洞地通过。
