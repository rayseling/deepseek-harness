# DeepSeek Harness — LAN fork

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的一个 fork，可以部署到 loopback 之外。

上游 `dsh` 是 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架），采用**一切皆插件**的架构，由 [Cordis](https://github.com/cordiverse/cordis) 驱动。上游文档在这里依然全部适用；本页只讲这个 fork 改了什么，以及怎样按这种方式运行它。

这个 fork 以合并方式跟随上游，当前携带 `dsh-v0.1.1-rc.1`。它不向上游提交 pull request，因此下面的内容都未经上游项目评审；上游的开发者预览警告同样成立：**未来将出现破坏兼容性的变更。**

## 这个 fork 改了什么

### 配置面能被谁触达，由部署决定

上游把配置面——`settings.*`、`credentials.*`、agent（智能体）preset 创作，以及原生的 `host.pickDirectory` / `host.openPath` 对话框——钉死在回环 `Host` 上，无论载体绑得多宽。另一台机器上的浏览器可以正常对话，但设置、模型提供方录入与 preset 创作都会得到 403。

这个 fork 给 `client-connection` 插件加了 `privilegedAuthority`。默认值 `loopback` 即上游行为；`trusted-hosts` 让该平面回应这个部署已经在 `trustedHosts` 里声明的那些授权。

Host 把由此形成的姿态作为 `remoteConfiguration` 经 `host.describe` 发布，页面通过 `connection.canConfigure()` 读取它，于是远程浏览器能事先知道一项设置是经 Host 持久化还是只留在页面内存里，而不是从一次失败的写入里才发现。

**`trusted-hosts` 是一次刻意的暴露，不是便利开关。**这道信任栅栏是 DNS 重绑定防御，不是认证：任何能以已声明授权抵达该服务器的一方，都可以读写这个部署的设置与凭据引用，并在宿主机屏幕上弹出原生对话框。只在网络可信、或前面有一层做认证的代理时才启用它。

### 机密脱敏 fail-closed

`dsh-settings` 的脱敏会证明每一个 `role('secret')` 位置确实被扣下。无法证明的位置会从所有层中一并扣除，并记入 `unprovable`，于是协议表层会把该 namespace 渲染为不可远程配置，而不是交出一个带着无声空洞的值。序列化后的 schema 信封按同样标准净化，因为机密字段的 `.default(...)` 会随其 meta 一起传出。

### 浏览器能在明文 HTTP 源上启动

`crypto.randomUUID` 只在安全上下文中存在，因此在以明文 HTTP 从非回环地址提供的页面上它是 `undefined`，第一次铸造 id 就会抛错，应用根本来不及启动。上游修了其中一个调用点。这个 fork 让 API proxy 的浏览器 RPC id 与编辑器的草稿附件 id 也走 `crypto.getRandomValues`，并有一个端到端测试在启动前删除 `Crypto.prototype.randomUUID`，把这条路径持续覆盖住。

### `dsh-llm-pi-ai` 把 `headers` 的值视为只写

header 值本身没有任何信息能告诉脱敏器哪一条是凭据，因此 profile 的 `headers` 字典每个元素都带 `role('secret')`：脱敏后的 `describe()` 会扣下全部值、只报出键名，配置界面渲染的是只写输入框而不是当前值。真实请求仍然使用真实值。

<a id="run"></a>

## 运行

这个 fork 没有发布到 npm，而 `npx @deepseek-ai/dsh` 安装的是上游，不包含上面这些改动。

<a id="run-from-source"></a>

### 从源码运行

```sh
git clone https://github.com/rayseling/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物，`pnpm dsh web` 直接使用这些产物、不再重新构建。Web UI 在 `http://127.0.0.1:3080` 启动，本机启动时还会用默认浏览器打开；传入 `--no-open` 可仅运行服务器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

## 把 Web UI 提供给你自己的网络

`dsh web --host 0.0.0.0` 是被刻意拒绝的：载体没有认证层，用一个命令行参数就绑定全部网卡，等于顺手把远程代码执行交给了网络。全接口部署改为在组合层面表达——写在某个 profile 的补丁层 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 里：

```yaml
- id: webserver
  config:
    host: '0.0.0.0'
    port: !!js ctx.webStartup.port ?? 3080

- id: connection
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
    privilegedAuthority: trusted-hosts
```

补丁会替换该行的整个 `config`，所以两个条目都复述了 bundle 提供的表达式。在全接口绑定下，Web 运行时会把本机的 LAN IPv4 字面量推导进 `trustedHosts`，因此按地址访问无需再声明；要按名字访问，还需要 `dsh web --trusted-host <name>`。

删掉 `privilegedAuthority` 那一行，就能在把对话界面提供给网络的同时，让配置面留在本机——那是出厂默认。保留它的前提是接受上面那段暴露：任何能抵达这台服务器的一方，本来就能驱动一个以启动账户身份执行 shell 命令的 agent，而放宽配置面等于把这个部署的设置与凭据引用也一并加进去。

## 其余部分

本页没有提到的一切，以上游文档为准。

- [Web UI 指南](docs/user/guide/index.zh.md)
- [开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)
- [AGENTS.md](AGENTS.md)，面向在本仓库工作的 agent
- 上游 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)，用于反馈 `dsh` 本身——本页这些改动相关的问题请留在本仓库

## 许可证

[MIT](LICENSE)，与上游一致。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
