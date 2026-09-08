# DeepSeek Harness

English | [中文](README.zh.md)

> **This mirror is not upstream.** It tracks [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) plus two commits, rebased on each release. One changes behaviour: it makes the Web UI's settings surface persist through the Host for **every authenticated page**, where upstream enables it only for a page served from loopback — so on a deployment reachable over a network, settings become readable and writable by anyone who holds a browser session, which is the intended behaviour here and may not be what you want. Authority still rests on Connection's trusted-host fence plus the signed session cookie, and that same session reaches the Host methods that open files on the host's own desktop (the settings document, a workspace path, a deliverable): neither upstream nor this mirror checks their origin, and only the settings document's button is hidden off loopback. The other fixes an upstream defect and changes no deployment choice: Connection registers a plugin's RPC channel on whichever `webServer` carrier is active, including one that starts or restarts later, without requiring the channel owner to inject `webServer`. Both are recorded as Agent Notes ([settings](.agents/notes/implemented/feature/2026-08-31-host-settings-on-every-authenticated-page.md), [connection](.agents/notes/implemented/bug-fix/2026-09-08-connection-rpc-channel-carrier-read.md)). Nothing else differs, and issues and pull requests belong upstream.

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
