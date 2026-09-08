# Agent Note: 在处于激活状态的载体上注册 Connection RPC 通道

Status: implemented

[English](2026-09-08-connection-rpc-channel-carrier-read.md) | 中文

## 问题

`fix: windows build` 把 `webServer` 从 Connection 自己的 `inject` 中删去（改为 `['credentials']`），以便 Electron 宿主在没有 HTTP 载体的情况下提供 Connection。`HostConnectionService.register()` 仍经 Cordis 属性访问器读取 `owner.webServer`，而该访问器依据 Connection 的声明、而非调用方的声明解析这个名字：像 Web bundle 那样由兄弟插件 fiber 提供的载体无法触及，读取会在注册 effect 内抛出 `cannot get property "webServer" without inject`。功能插件注册的每个专用通道都没有路由：启动照常完成，对该通道的 POST 落到静态服务器并返回 405。上游调用方只使用不需要载体的 `rpc.intercept`，因此仓库内的测试从未观察到它。

## 决策

这个镜像为此在上游之上带一个提交。`register()` 先在 Connection 自己的通道集合中占用该通道，因此注册一个已注册的通道会把 `connection: RPC channel "<channel>" is already registered` 抛给调用方。随后它在 `owner.inject(['webServer'], …)` 内注册前缀路由：通道持有者的这个子 fiber 在每次有 `webServer` 载体激活时注册路由，包括注册之后才启动的载体和重启后替换原载体的新载体，子 fiber 销毁时移除路由。返回的 disposer 销毁子 fiber 并释放占用；销毁持有者也会如此。子 fiber 用 `webCtx.get('webServer')` 读取载体，这是 `packages/AGENTS.md` 规定的严格全局存储读取，因为子 context 保留 Connection 的 shadow，其属性访问器会抛出同一个 `without inject` 错误。Connection 自己的 `/api` 路由也经同类注入跟随载体。

`HostConnectionRpc.handle` 记录了对载体的依赖。`tests/node-half.host.spec.ts` 由载体自身的插件 fiber 提供载体，并通过经 `ctx.inject(['connection'], …)` 访问 Connection 的消费者注册；它覆盖注册与移除、注册之后才挂载的载体、重启后的载体、持有者销毁时的移除，以及已释放通道的重新注册。上游在根上提供载体的 spec 会等待路由出现，因为路由异步落到载体上，它们的重复检查也改为期待 Connection 的错误。

## 曾考虑的替代方案

**把 `webServer` 加回 Connection 的 `inject`。** 属性读取会重新成功，但 Connection 在不提供 HTTP 载体的 Electron 宿主中将永远不会激活。

**注册时用 `owner.get('webServer')` 读取一次载体，没有激活载体就抛错。** 路由永远到不了注册之后才启动的载体或重启后替换原载体的新载体，因此载体一重启，通道就返回 405。若注册发生在嵌套的 `ctx.inject(['connection'], …)` 回调中，抛错也只会让该子 fiber 失败，启动审计不会报告它。

**在每个通道持有者的 `inject` 中声明 `webServer`。** 这无法让读取成功：访问器检查的是 Connection 的声明，调用方的 `inject` 仍会得到同一个错误。

**把载体挂在 Connection 的祖先 context 上。** 访问器能解析由祖先 context 提供的载体（根上提供的测试替身正是如此），但 Web bundle 把 `webserver` 作为普通插件行挂载，改动它会改变每个提供 GUI 的 profile 的组合。

## 后果

`rpc.handle` 在路由落到载体之前就返回，这段间隔内的请求由静态回退应答。没有激活载体时注册的通道在载体激活前一直没有路由；在不提供 HTTP 载体的 Electron 宿主中，专用通道永远不会有路由。Connection 只在自己的通道之间检测重复：若另一个插件直接在载体上以同一路径注册了前缀路由，只有该通道的子 fiber 失败，并由 logger 报告。

该修复不在上游，[讨论 #5889](https://github.com/deepseek-ai/deepseek-harness/discussions/5889) 报告了同一缺陷。
