# Agent Note: CLI 拒绝通配绑定地址

Status: implemented

[English](2026-08-13-cli-refuses-wildcard-host.md) | 中文

## 问题

`dsh web --host 0.0.0.0` 曾是一个对外宣传的参数：选项帮助写着「bind host; pass 0.0.0.0 to reach it from another machine」，示例行还给出「reach it from another machine on the LAN」（加入它的决策是 [web 绑定地址](../feature/2026-07-22-web-bind-address.md)）。

这个参数实际产生的，是一个没有认证层、却监听在所有网络接口上的载体。`/api` 这个面上有 `session.prompt`，它驱动的 agent 可以运行 bash；而 `/api` 的 Host 围栏是混淆代理人防御，不是认证层（[api 浏览器信任边界](../architecture/2026-07-28-api-browser-trust-boundary.md)）。因此一个单词参数成了产品里把远程代码执行交给网络的最短路径，而帮助文本还把它当作「从手机访问 GUI」的常规做法推荐出去。

## 决定

启动器拒绝它。`web-startup` 在发布 `webStartup` 之前就把 `--host 0.0.0.0` 判为 usage error，于是没有任何端口被绑定；`dsh --profile web --help` 里的选项说明与那条 LAN 示例一并撤除。拒绝信息给出的不只是约束，还有原因和替代方案：全接口绑定「would expose remote code execution to the network; use 127.0.0.1 instead」。

全接口绑定本身未被触碰。`dsh-host-webserver` 的 `host` schema 仍然接受 `'0.0.0.0'`，所以需要它的部署经 profile patch 或程序化组合设置 `webserver` 行的 `config.host`；Web 运行时也仍会把该机器的 LAN IPv4 字面量推导进 connection 行的 `trustedHosts`，让由此得到的 LAN URL 通过 Host 围栏。改变的是谁来做这个选择：编辑配置文件的组合作者，而不是帮助界面推荐的一个参数。

这取代了 [web 绑定地址](../feature/2026-07-22-web-bind-address.md) 中属于 CLI 的那一半。该 Note 在载体层面的决定——`WebServerOptions.host` 必填且不提供回退、默认回环、打印回环与外部 URL——全部仍然成立。

## 考虑过的替代方案

- **保留参数但打印警告。** 不予采纳：对一个本身就以网络暴露为目的的参数发警告，并不改变操作者最终得到的东西，而帮助文本还是在推荐它。
- **保留参数但加确认提示。** 提示无法覆盖最需要防护的非交互式调用（进程守护、容器 entrypoint），而那恰恰是会绑定到全网且长期在线的部署。
- **先做认证层，再保留参数。** 这是真正诚实的修法，也仍然是恢复该参数的条件；但在那之前把拒绝一直推迟，等于让暴露继续留在产品里。
- **改为接受其他接口地址**（具体的 LAN IP 而非通配地址）。暴露性质相同、影响面略小，但它需要同一套认证方案，且为 CLI 的约定再添一种网络模式，安全上并无所得。

## 影响

`dsh web` 要让另一台机器上的浏览器访问，只能通过显式选择的组合来实现；CLI 保留的参数家族是 `--port` 与 `--trusted-host`。照旧帮助文本操作的人会得到一条说明原因的 usage error，而不是被静默绑到回环。

这类部署上的浏览器确实能完成启动：id 铸造不依赖安全上下文（[非安全源 UUID 铸造](../bug-fix/2026-08-17-insecure-origin-uuid-minting.md)），那是本决策之前就存在的另一个缺陷。特权方法的钉定在那里依然把配置面限制为回环专属，所以远程浏览器可以对话、可以跑工具，但不能重新配置这套部署。

恢复一个用于全接口绑定的 CLI 参数，取决于 Web 载体获得认证层，而 connection 包把它记录为延期工作。

## 测试

`packages/bundle/web-app/tests/startup.spec.ts` 钉住这次拒绝：`--host 0.0.0.0` 以上述信息作为 usage error 退出、且不提供 `webStartup`，而其他 `--host` 取值仍能正常解析。组合路径仍由 webserver 包自身的监听测试覆盖，它把回环模式与全接口模式向 Node 监听边界的传递固定为约定。
