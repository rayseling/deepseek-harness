# Agent Note: 通过软读取载体注册 Connection RPC 通道

Status: implemented

[English](2026-09-08-connection-rpc-channel-carrier-read.md) | 中文

## 问题

`fix: windows build` 把 `webServer` 从 Connection 自己的 `inject` 中删去（改为 `['credentials']`），以便 Electron 宿主在没有 HTTP 载体的情况下提供 Connection。`HostConnectionService.register()` 仍经 Cordis 属性访问器读取 `owner.webServer`，而该访问器依据 Connection 的声明、而非调用方的声明解析这个名字：像 Web bundle 那样由兄弟插件 fiber 提供的载体无法触及，读取会在注册 effect 内抛出 `cannot get property "webServer" without inject`。功能插件注册的每个专用通道都没有路由：启动照常完成，对该通道的 POST 落到静态服务器并返回 405。上游调用方只使用不需要载体的 `rpc.intercept`，因此仓库内的测试从未观察到它。

## 决策

这个镜像为此在上游之上带一个提交：`register()` 用 `owner.get('webServer')` 读取载体——这是 `packages/AGENTS.md` 为插件未 inject 的服务规定的严格全局存储读取——并在 `owner.effect` 内注册前缀路由，使通道持有者保有 disposer。注册时若没有处于激活状态的载体，它会抛出 `connection: RPC channel "<channel>" needs a webServer carrier`。

`HostConnectionRpc.handle` 记录了这一要求，`tests/node-half.host.spec.ts` 覆盖两条路径：载体由其自身插件 fiber 提供时，经 `ctx.inject(['connection'], …)` 访问 Connection 的消费者能注册并移除路由；没有载体时注册会抛出该具名错误。

## 曾考虑的替代方案

**把 `webServer` 加回 Connection 的 `inject`。** 属性读取会重新成功，但 Connection 在不提供 HTTP 载体的 Electron 宿主中将永远不会激活。

**经 `owner.inject(['webServer'], …)` 注册。** 路由会等待载体出现并跟随其重启，但在永远不会出现载体的地方注册的通道会无错误地一直没有路由，而 `register()` 会把该具名错误抛给注册通道的代码。

**在每个通道持有者的 `inject` 中声明 `webServer`。** 这无法让读取成功：访问器检查的是 Connection 的声明，调用方的 `inject` 仍会得到同一个错误。

**把载体挂在 Connection 的祖先 context 上。** 访问器能解析由祖先 context 提供的载体（根上提供的测试替身正是如此），但 Web bundle 把 `webserver` 作为普通插件行挂载，改动它会改变每个提供 GUI 的 profile 的组合。

## 后果

插件必须在载体处于激活状态时注册其通道，且注册不会在之后取代该载体的新载体上重做。没有激活载体时运行的注册会把该具名错误抛给调用 `rpc.handle` 的代码：若调用发生在条目插件自身的 `apply` 中，该条目失败，启动审计会把它报告为未激活的条目；若发生在嵌套的 `ctx.inject(['connection'], …)` 回调中，只有该子 fiber 失败，条目保持激活，启动审计不会报告它，对该通道的 POST 返回 405。

该修复不在上游，[讨论 #5889](https://github.com/deepseek-ai/deepseek-harness/discussions/5889) 报告了同一缺陷。
