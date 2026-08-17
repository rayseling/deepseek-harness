# Agent Note: Browser carriers mint ids without a secure context

Status: implemented

English | [中文](2026-08-17-insecure-origin-uuid-minting.zh.md)

## Problem

The Web GUI booted only from a loopback authority. Served over plain HTTP from anything else — a LAN address after `webserver.host: '0.0.0.0'`, a reverse-proxied host — the page loaded and then the app died during boot with `crypto.randomUUID is not a function`, and no `/api` request ever reached the server.

`crypto.randomUUID` is a secure-context-only Web API. Browsers grant secure-context status to `https:` origins and to `http://localhost` / `http://127.0.0.0/8`, and to nothing else, so on `http://192.168.x.y:3080` the method is `undefined` while `crypto.getRandomValues` — not gated — stays available.

`AbstractApiClient.mintRpcId()` called it. That is the one minting point every unary `/api` request shares (`WebApiClient` inherits it; a `respond` carries no fresh id — the initiator mints, a response echoes), and `ConnectionController`'s readiness handshake is `host.describe`, so the first request of the first connection generation threw before the client could subscribe to anything. The composer's draft-attachment id (`ui-conversation`) had the same call.

The `/api` Host fence was already satisfied in this configuration: an all-interfaces bind derives the machine's LAN IPv4 literals into `client-connection`'s `trustedHosts`, and requests carrying an IP-literal Host pass. Reachability and trust were correct; the client simply could not mint an id. An all-interfaces deployment — `webserver.host: '0.0.0.0'` through a profile patch or a programmatic composition; the CLI's own `--host 0.0.0.0` is a usage error ([the CLI refuses the wildcard bind host](../simplification/2026-08-13-cli-refuses-wildcard-host.md)) — and the LAN URL its startup line advertises were therefore unusable from a browser, which is what community reports [#221](https://github.com/deepseek-ai/deepseek-harness/discussions/221) and [#514](https://github.com/deepseek-ai/deepseek-harness/discussions/514) describe.

One minting path was already correct. `packages/client/connection/src/client/rpc.ts` mints through a package-private `randomUuid()` built on `getRandomValues`, added for the generic Connection channels. Its existence is what made the failure look configuration-shaped: some traffic minted fine, while the carrier that boots the app did not.

## Decision

One `randomUuid()` serves every browser carrier, and it lives in the apiproxy `api/` layer — the layer whose documented contract is "zero Node dependencies, importable from the browser". `AbstractApiClient.mintRpcId()`, the connection channel caller, the fixture carrier, and the composer's draft attachment all mint through it; the connection client's package-private copy (its `client/random-uuid` module) is deleted, so the monorepo holds exactly one copy. Bundle-heavy consumers import the exact-module subpath (`/api/random-uuid`) rather than the `/api` barrel, whose evaluated protocol schemas would otherwise ride into a browser bundle for one helper.

`api/` is the correct owner rather than a client package because the dependency runs `client/connection` → `host/apiproxy`: the minter must sit at or below the lowest consumer, and `AbstractApiClient` is defined in apiproxy itself. Client bundles reach it as a value import, which the purity gate already admits for this specifier family (`INLINE_SAFE` in `packages/client/tsdown.client.ts`) — inlining a wire layer per bundle is the intended shape, so no allowlist changed.

`dsh-brand` was the other candidate every consumer already depends on and was refused: it is documented as type-only, carrying no runtime code, and a CSPRNG call is exactly the runtime it excludes.

The construction is unchanged from the helper it replaces — 16 random bytes with the version-4 and variant nibbles overwritten, hex-formatted — so ids stay RFC 4122 version 4 and stay CSPRNG-backed. `Math.random()` is not a fallback anywhere: an id that correlates a request with its response has no reason to be predictable, and the primitive that survives an insecure origin is a CSPRNG already.

## Alternatives considered

- **A new `packages/util/random-uuid` package.** The semantically clean home, and the only one that could also serve `dsh-llm` (see Consequences). Refused for this fix: it costs a package's full apparatus — manifest, tsconfig face, bilingual README, invariant entry, coverage, hygiene and catalog regeneration — to relocate seven lines, and it is a decision about where zero-dependency runtime utilities live rather than about this defect. It remains the move if a third plane ever needs the minter.
- **Keeping a private copy per package.** Three copies of one seven-line function, which the duplication gate rejects at `minTokens: 60` with a failing exit code, and which would leave the next such fix to be applied three times.
- **Hosting the minter in `dsh-llm`.** Mechanically the widest reach — apiproxy already depends on it, and its subpaths are inline-safe — but it puts a UUID minter inside the LLM capability package, which owns message and stream vocabulary and nothing like this.
- **Polyfilling `crypto.randomUUID` at shell boot.** One assignment covers every present and future call site, including code this repo does not own. Refused because it mutates a platform global whose absence is a deliberate browser signal, and it hides the constraint from the next author instead of stating it where ids are minted.
- **Serving the GUI over TLS instead.** A real deployment answer, and the one that also fixes clipboard and other secure-context APIs, but it makes an unauthenticated carrier's reachability depend on certificate provisioning, and the bug is a browser-API misuse that exists whatever the transport.

## Consequences

A Web deployment bound to all interfaces is usable from a browser: the readiness handshake, every unary call, and draft image attachment mint ids on an insecure origin. The downlink WebSocket frames were never affected — the host mints their ids with `node:crypto`. Loopback behaviour is unchanged, because `getRandomValues` is available there too and the id format is identical. All-interfaces binding itself remains a composition choice, not a CLI flag ([the CLI refuses the wildcard bind host](../simplification/2026-08-13-cli-refuses-wildcard-host.md)).

The privileged-method pin is untouched and still decides what a non-loopback client may do: `settings.*`, `credentials.*`, `llm.discoverModels`, `host.pickDirectory`/`openPath`, and the agent-preset authoring methods answer 403 to a LAN Host, so a remote browser can converse and run tools but cannot reconfigure the deployment. This fix removes a crash, not that boundary, and adds no authentication — a non-loopback bind still trusts its network.

One call site is deliberately left: `createMessage()` in `packages/llm/llm/src/message.ts` still uses `crypto.randomUUID`. It reaches a browser only through `packages/client/connection/src/client/fixture.ts`, the fake carrier that serves standalone UI development, so it throws on an insecure origin in fixture mode alone. It cannot import this helper — `host/apiproxy` depends on `dsh-llm`, and the reverse edge would be a cycle — and duplicating the helper there would trip the duplication gate. Fixing it needs the util package weighed above; until then, fixture mode wants a loopback origin.

## Testing

`packages/host/apiproxy/tests/fetch-carrier.spec.ts` pins the defect at its minting point: with `crypto` stubbed down to `getRandomValues` alone — the insecure-origin environment — a unary call completes and the observed envelope carries `00000000-0000-4000-8000-000000000000`, the deterministic all-zero-randomness UUID whose version and variant nibbles prove the bits are still set. A second case asserts real randomness yields distinct version-4 ids. Before the fix the first case throws `crypto.randomUUID is not a function`, which is the reported failure reproduced under the gate.

The existing insecure-origin assertion for the generic channel (`packages/client/connection/tests/client-apply.client.spec.ts`) is unchanged and still passes over the shared helper, which is what shows the deletion of the package-private copy preserved that path. The two rewired call sites each pin their own wiring the same way: the fixture-carrier suite stubs `crypto` after fixture construction (the seeded history still mints through `dsh-llm`, the recorded gap) and asserts the deterministic id on a live request, and the composer suite does the same through `createDraftImages`. Reverting any call site to `crypto.randomUUID` fails its test.

The assembled application is covered by a keyless web e2e (`apps/web/tests/insecure-origin-boot.e2e.ts`): a real Chromium page loads the built Web composition with `crypto.randomUUID` deleted before any page script runs — the API surface of a plain-HTTP non-loopback origin — and the boot must complete with zero page errors. A browser cannot fake the origin classification itself from localhost, so the test removes the API the classification would remove; the deployment-level reproduction (a second host on the LAN) stays manual.
