# DeepSeek Harness — LAN fork

English | [中文](README.zh.md)

A fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) that is deployable beyond loopback.

Upstream `dsh` is an open-source agent harness from [DeepSeek AI](https://deepseek.com), built so that **everything is a plugin** and powered by [Cordis](https://github.com/cordiverse/cordis). Everything upstream documents still holds here; this page covers only what the fork changes and how to run it that way.

The fork follows upstream by merge and currently carries `dsh-v0.1.1-rc.1`. It opens no upstream pull requests, so nothing below has been reviewed by the upstream project, and upstream's developer-preview warning applies unchanged: **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## What this fork changes

### The configuration plane's reach is a deployment choice

Upstream pins the configuration plane — `settings.*`, `credentials.*`, agent-preset authoring, and the native `host.pickDirectory` / `host.openPath` dialogs — to a loopback `Host`, however wide the carrier binds. A browser on another machine can hold a conversation, but Settings, provider entry, and preset authoring answer 403.

This fork adds `privilegedAuthority` to the `client-connection` plugin. `loopback`, the default, is upstream's behavior. `trusted-hosts` lets that plane answer the same authorities the deployment already declares in `trustedHosts`.

The Host publishes the resulting posture on `host.describe` as `remoteConfiguration`, and the page reads it through `connection.canConfigure()`, so a remote browser knows whether a setting persists through the Host or stays in page memory instead of learning it from a failed write.

**`trusted-hosts` is a deliberate exposure, not a convenience.** The trust fence is a DNS-rebinding defense, not authentication: anything that reaches the server on a declared authority can read and write this deployment's settings and credential references and pop native dialogs on the host's screen. Set it only where the network is trusted or an authenticating proxy sits in front.

### Secret redaction fails closed

`dsh-settings` redaction proves that every `role('secret')` position was withheld. A position it cannot prove is withheld from every layer and reported as `unprovable`, so a wire surface renders that namespace as not remotely configurable rather than serving a value with silent holes. The serialized schema envelope is sanitized on the same terms, because a secret field's `.default(...)` rides its meta.

### The browser boots on a plain-HTTP origin

`crypto.randomUUID` is secure-context-only, so it is `undefined` on a page served over plain HTTP from anything but loopback, and the first id minted throws before the app boots. Upstream fixed one call site. This fork mints the API proxy's browser RPC ids and the composer's draft-attachment ids through `crypto.getRandomValues` as well, and an end-to-end test deletes `Crypto.prototype.randomUUID` before boot so the path stays covered.

### `dsh-llm-pi-ai` treats `headers` values as write-only

Nothing in a header value tells a redactor which entry is a credential, so every entry of a profile's `headers` dict carries `role('secret')`: a redacted `describe()` withholds all values and reports only the key names, and a configuration UI renders write-only inputs instead of the current ones. Requests still send the real values.

## Run

This fork is not published to npm, and `npx @deepseek-ai/dsh` installs upstream, which carries none of the changes above.

### Run from source

```sh
git clone https://github.com/rayseling/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts, and `pnpm dsh web` uses them without rebuilding. The Web UI starts at `http://127.0.0.1:3080` and opens in the default browser for a local launch; pass `--no-open` to run the server without one. See the [Web UI guide](docs/user/guide/index.md).

## Serve the Web UI on your own network

`dsh web --host 0.0.0.0` is refused on purpose: the carrier has no authentication layer, so binding every interface from a flag would hand remote code execution to the network as a side effect of one argument. An all-interfaces deployment is a composition choice instead, made in a profile's patch layer at `$DSH_HOME/profiles/<name>/cordis.patch.yml`:

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

A patch replaces the row's whole `config`, which is why both entries restate the expressions the bundle supplies. Under an all-interfaces bind the Web runtime derives this machine's LAN IPv4 literals into `trustedHosts`, so reaching the UI by address needs no further declaration; reaching it by name additionally needs `dsh web --trusted-host <name>`.

Drop the `privilegedAuthority` line to serve the conversation UI to the network while the configuration plane stays same-machine, which is the shipped default. Keep it only with the exposure above accepted: anything that reaches this server can already drive an agent that runs shell commands as the account it was started under, and widening the plane adds this deployment's settings and credential references to that.

## Everything else

Upstream's documentation is the reference for everything this page does not mention.

- [Web UI guide](docs/user/guide/index.md)
- [Development guide](docs/development.md) and [architecture](docs/architecture.md)
- [AGENTS.md](AGENTS.md), for agents working in this repository
- Upstream [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions), for feedback on `dsh` itself — anything about the changes on this page belongs in this repository instead

## License

[MIT](LICENSE), unchanged from upstream.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
