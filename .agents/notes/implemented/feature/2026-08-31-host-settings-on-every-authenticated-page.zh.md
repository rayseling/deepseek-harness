# Agent Note: 在每个已认证页面上经 Host 持久化设置

Status: implemented

[English](2026-08-31-host-settings-on-every-authenticated-page.md) | 中文

## 问题

上游根据页面主机名选择 settings 持久化模式：由 loopback 分发的页面得到 `host`，其他任何 authority 都得到 `memory`。describe 镜像是浏览器里唯一的 `settings.describe` 读取方，在 `memory` 模式下 `load()` 与 `ensure()` 不发起协议调用就返回。因此经局域网地址打开的页面从不读取设置：每个共享表单都报告不可用，模型页显示 `settings are unavailable in this browser` 而不是提供方目录，插件设置页没有内容可渲染，外观、语言、繁忙态 Enter 与引导确认也只保留在进程内。这个镜像把 Web UI 提供给家庭网络中的其他设备，在那里该模式使设置对话框无法使用。

## 决策

这个镜像为此在上游之上带一个提交：`dsh-client-ui-settings` 对每个页面都把持久化解析为 `host`（`src/client/index.ts` 中的 `const persistence = 'host'`），并把这个值交给 `SettingsDescribeMirror` 以及 `ConfigForms` 创建的每个共享表单。任何 authority 上的页面都经 Host 读写设置。

授权仍由 Connection 负责：每个 `/api` 调用与 WebSocket 升级都要通过可信主机围栏，并要求签名的浏览器会话 cookie，缺少 cookie 时返回 401。`settings.describe` 仍按字段角色脱敏机密值。

在宿主机桌面上执行动作的 Host 方法——`settings/openSettingsDocument`、`session/openWorkspacePath` 与交付物的 `/api/present.open` 路由——在上游和这个镜像中都没有来源检查，因此任何持有浏览器会话的页面都能调用它们。`dsh-client-ui-settings-general` 在非 loopback 页面上不提供**打开配置文件**操作；这只隐藏控件，Host 端不做任何强制。

`memory` 模式仍保留在 `SettingsDescribeMirror` 与 `ConfigFormController` 中，但没有出厂选择方，因此这一行改动在 rebase 时无需触碰它们的签名。这是对「每个选项都需要当前使用方」这条包规则的有意例外：删除该模式会让每次 rebase 都重写这两个类、它们的 spec 以及上游调用方，保留它则让恢复上游行为始终只需回退一行。

本笔记取代 [Host 支撑的偏好笔记](../bug-fix/2026-08-06-host-backed-web-preferences.zh.md) 中所述的仅限 loopback 的范围；该笔记仍负责偏好 schema、镜像生命周期与写入顺序。

## 曾考虑的替代方案

**保留 loopback 规则，并在每台设备上通过端口转发访问 GUI。** 每部手机和笔记本都要建隧道才能打开设置，而 GUI 的其他部分已经可以经已认证的局域网地址使用。

**增加一个按部署选择模式的 `Config` 字段。** 上游约定倾向于用经校验的字段表达部署选择，但该字段会在多个上游文件中增加 schema、bundle 接线与文档，每次 rebase 都要带着它们。这个镜像只服务一个部署。

**在 Host 端为桌面动作增加来源检查。** 持有浏览器会话的页面已经能通过 agent 运行 shell 命令，因此对这些打开文件的方法做来源检查，保护不了该会话经其他途径触及不到的任何东西。

## 后果

在可经网络访问的部署上，任何持有浏览器会话的人都能读写每个已注册的 settings 命名空间，包括模型提供方路由；机密值仍被脱敏。每台设备读写同一份 Host 文档，因此在一台设备上选择的语言、主题、字号或引导确认会作用于所有其他设备，以最后一次写入为准。每个页面在启动时发起两次 describe 读取，与 loopback 页面相同。

`ui-settings-general`、`ui-settings-models` 与 `ui-theme` 的 `tests/apply` spec，以及 `ui-settings` 的开发者工具 spec，断言非 loopback 页面使用 `host` 持久化，主机名选择器一旦回来它们就会失败。`apps/web/tests/remote-welcome.e2e.ts` 场景在非 loopback 页面上确认欢迎声明，并断言 Host 文档记下了该确认、刷新后声明不再出现。各消费包 README（`locale`、`ui-theme`、`ui-settings`、`ui-settings-models`、`ui-settings-general`、`ui-chat`）以及曾把远程页面写成进程内偏好的偏好笔记（性能与用量、开发者工具、开发者工具默认开启）描述这一策略，根 README 的披露块向镜像读者说明它。
