# Agent Note: 配置面按需跟随 trustedHosts

Status: implemented

[English](2026-08-17-configuration-plane-authority.md) | 中文

## 问题

特权方法集合——`settings.*`、`credentials.*`、`llm.discoverModels`、`host.pickDirectory`/`openPath` 以及 agent preset 的编写类方法——以空信任表通过 `/api` 信任栅栏，因此只有回环 Host 能抵达。这是[api 浏览器信任边界](2026-07-28-api-browser-trust-boundary.md)选定的姿态，依据是 `trustedHosts` 属于 DNS rebinding 防御而非认证；但它把这个选择写死了：那张空表是三个调用点上的字面量，部署方没有任何办法作出别的决定。

这让一套全接口部署处于半可用状态，而且不给操作者任何可权衡的东西。远程浏览器可以对话、可以跑工具——`session.prompt` 驱动的 agent 能运行 bash，这是整个面上后果最重的方法，而它从未被钉住——但模型设置页渲染不出来，因为 `settings.describe` 回 403，客户端报 `transport failure for /api/settings.describe: HTTP 403`。于是这条边界拒绝了「配置一个 provider 所需的读取」，却放行了「执行任意命令的方法」；而唯一的补救是换一条路重新抵达那台机器（SSH 隧道、改写 Host 的反向代理），或者在 fork 里把这个钉子拆掉。

## 决定

`client-connection` 接受 `privilegedAuthority: 'loopback' | 'trusted-hosts'`，默认 `loopback`。默认值逐字复现原有行为，因此任何已发布的组合都不改变；`trusted-hosts` 则把本部署自己的 `trustedHosts` 交给普通方法本来就在通过的那道栅栏。

该字段只管辖 {@link PRIVILEGED_METHODS}，别的都不管。通用 Connection 通道声明的 `authority: 'loopback'` 无论本字段怎么设，都继续以空表通过栅栏，因为这两者的所有者不同：特权方法集合属于本包，策略也属于本包；而 `authority: 'loopback'` 是*其作者自己写下的要求*。一个悄悄放宽别的包已声明要求的部署字段，会让那份声明变得毫无意义，而未来的消费者可能因此获得它从未接受过的远程调用方。

放宽并不削弱栅栏本身。`trusted-hosts` 点名的是授权：未声明或被重绑的 Host 在完全相同的方法上仍被拒绝，`assertTrustedAuthority` 也仍在加载期拒绝畸形条目。改变的是配置面答复哪些具名授权，而这是部署方需要自己声明的事实。

让回环成为默认值的那套理由未变，也正是它保持默认的原因：这道栅栏不是认证，所以 `trusted-hosts` 会把配置面——设置读写、凭据引用状态、preset 编写、宿主屏幕上的原生对话框——交给一切能抵达该载体的东西。选择它的部署，等于在断言自己的网络可信，或前面有一层做认证的代理。这个断言应由部署方作出；把它硬编码为不可能，只是把同样的暴露挪进了 fork 与改写 Host 的代理里，而在那里它对本仓库的门禁与文档都是不可见的。

## 考虑过的替代方案

- **在载体获得认证之前保持写死的钉子。** 这是信任边界 Note 选定的姿态，也仍然是正确的默认值。作为「唯一选项」被否决：它并不阻止暴露，只是让暴露转移——落地的答案变成了「在反向代理里把 Host 改写成 127.0.0.1」，那是整体废掉 rebinding 栅栏而非点名授权，而且发生在本仓库既不记录也不测试的地方。
- **先给载体加认证。** 这是诚实的修法，也是 `trusted-hosts` 在自己的 JSDoc 里读起来像权宜之计的原因。但那是大得多的设计——凭据存储、会话有效期、登录界面、独立的威胁模型——把一个单字段的部署选择卡在它后面，恰恰催生了那些 fork 补丁。
- **按方法逐项放开**（例如 `privilegedMethods: string[]`，允许某部署放开 `settings.describe` 但不放开 `credentials.set`）。否决：这个集合按设计就是一个整体的面——读与写同等特权，因为 describe 会返回已暴露的配置——所以部分放开会诱使部署方相信自己保住了一条其实并不存在的边界。
- **用布尔值**（`allowRemoteConfiguration: true`）。具名联合说明了请求是拿什么来衡量的；布尔值会让「remote」恰好在读者最需要知道「它意味着 `trustedHosts` 而不更宽」的时刻失去定义。
- **由绑定地址推导模式**（全接口即视为放宽）。否决：可达性与信任在本设计中是刻意分开的，从其一推出其二，正是一套部署获得自己从未写下的暴露的方式。

## 影响

设置了 `privilegedAuthority: 'trusted-hosts'` 的全接口部署，会把模型页与设置页、凭据录入、preset 编写以及目录选择器，提供给它所声明的那些授权。同一套部署若保持默认，那里仍然答 403，而用户读到的原因语句现在会点出这个字段。

`host.pickDirectory` 能被远程浏览器抵达，是它对自身限制的诚实表达，而不是新坏掉的东西：原生选择器开在宿主屏幕上，这正是自适应选择器在全接口绑定下已经解析为 `browse` 的原因（[目录选择器的自适应默认值](../feature/2026-07-29-directory-picker-adaptive-default.md)）。一套既钉住原生选择器、又放宽本字段的部署，会得到一个没人站在跟前的对话框。

认证方面没有任何改变，信任边界 Note 的威胁模型在两种模式下同样管辖：跨站请求、不透明源与被重绑的 Host 在 `trusted-hosts` 下与在 `loopback` 下同样被拒绝。要恢复更严的姿态，改的是一个字段，而不是回退一个补丁。

正是放宽这个字段，把设置协议自身的脱敏缺口从「一台机器可达」变成了「一个网络可达」，所以值的保证必须先变成 fail-closed（[按 fail-closed 脱敏](2026-08-17-fail-closed-secret-redaction.md)）。把配置面提供给一个网络之所以站得住，只因为密钥已经不可能再随一份被描述的值流出。

## 测试

`packages/client/connection/tests/node-half.host.spec.ts` 用同一个已声明授权钉住三个位置：既有场景继续证明默认下每个特权方法都回 403、而普通读取通过；与它配对的场景证明在 `trusted-hosts` 下这些方法能抵达载体，而未声明的 Host 在同样这些方法上仍回 403，因此这次放宽是被栅栏约束的、而非取代了栅栏；第三个场景在 `trusted-hosts` 下注册一个带 `authority: 'loopback'` 的通用通道与一个共享 interceptor，证明两者仍然拒绝那个已声明授权、且两个 handler 都没有运行。
