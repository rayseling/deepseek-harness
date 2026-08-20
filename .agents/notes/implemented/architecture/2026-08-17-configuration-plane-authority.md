# Agent Note: The configuration plane follows trustedHosts on request

Status: implemented

English | [中文](2026-08-17-configuration-plane-authority.zh.md)

## Problem

The privileged method set — `settings.*`, `credentials.*`, `llm.discoverModels`, `host.pickDirectory`/`openPath`, and the agent-preset authoring methods — passed the `/api` trust fence with an empty trust list, so only a loopback Host reached it. That is the posture [the api browser-trust boundary](2026-07-28-api-browser-trust-boundary.md) chose, on the reasoning that `trustedHosts` is a DNS-rebinding defense rather than authentication, and it hard-coded the choice: the empty list was a literal at three call sites, with no way for a deployment to decide otherwise.

That leaves an all-interfaces deployment half usable and gives its operator nothing to weigh. A remote browser converses and runs tools — `session.prompt` drives an agent that runs bash, which is the most consequential method on the surface and was never pinned — but the Models page cannot render, because `settings.describe` answers 403 and the client reports `transport failure for /api/settings.describe: HTTP 403`. So the boundary refused the reads that let someone configure a provider while admitting the method that executes arbitrary commands, and the only remedies were to re-reach the machine some other way (an SSH tunnel, a Host-rewriting proxy) or to patch the pin out of a fork.

## Decision

`client-connection` takes `privilegedAuthority: 'loopback' | 'trusted-hosts'`, defaulting to `loopback`. The default reproduces the previous behaviour exactly, so no shipped composition changes; `trusted-hosts` passes the deployment's own `trustedHosts` to the same fence the ordinary methods already pass.

The field governs {@link PRIVILEGED_METHODS} and nothing else. A generic Connection channel declaring `authority: 'loopback'` keeps passing the fence with an empty list however this is set, because those two things have different owners: the privileged method set belongs to this package, which also owns the policy, while `authority: 'loopback'` is a *requirement its own author wrote down*. A deployment field that silently relaxed another package's stated requirement would make that declaration worthless, and a future consumer could acquire remote callers it never accepted.

Widening the carrier is only half of it: the browser has to know. `host.describe` reports `remoteConfiguration`, registered by the carrier that owns the policy, and the client's `ConnectionHandle` exposes `canConfigure()` — loopback, or that capability. The shared settings describe mirror selects its mode through that call rather than the page's hostname, re-read on every read entry and adopted when the Host description lands, so a remote page upgrades from process-local to Host with the handshake instead of being pinned at construction; every derived scope, the welcome acknowledgement included, takes its mode from that one mirror. Without it the carrier would answer `settings.describe` while every remote page kept writing to memory, which is a widened plane nobody can use. `settings.openDocument` stays keyed to `isLoopback` on purpose: the native editor opens on the Host's screen, so a remote operator has nothing to look at.

Two mechanisms that registration needs, both learned by getting them wrong first. It goes through `ctx.inject(['apiProxy'])`, because `apiProxy` is optional to this plugin and a one-shot `ctx.get` at apply time misses a row that settles later. And the slot the carrier writes cannot be a `#` private field: this service is reached through the cordis tracker proxy, which forwards a property read but not a private-field write, so `describe` read one object while the registration mutated another. It is a stable object mutated in place — the trap [packages/AGENTS.md](../../../../packages/AGENTS.md) names for service state.

Widening does not weaken the fence itself. `trusted-hosts` names authorities; an undeclared or rebound Host is still refused on exactly the same methods, and `assertTrustedAuthority` still rejects a malformed entry at load. What changes is which named authorities the configuration plane answers, which is the deployment's fact to state.

The reasoning that made loopback the default is unchanged and is why it stays the default: the fence is not authentication, so `trusted-hosts` hands the configuration plane — settings reads and writes, credential-reference state, preset authoring, native dialogs on the Host's screen — to anything that can reach the carrier. A deployment choosing it is asserting that its network is trusted or that an authenticating proxy sits in front. That assertion is a deployment's to make; hard-coding it as impossible only moved the same exposure into forks and Host-rewriting proxies, where it is invisible to this repo's own gates and documentation.

## Alternatives considered

- **Leave the pin hard-coded until the carrier has authentication.** The posture the boundary note chose, and still the right default. Refused as the only option because it does not prevent the exposure, it relocates it: the shipped answer became "rewrite Host to 127.0.0.1 in a reverse proxy", which defeats the rebinding fence wholesale rather than naming authorities, and does so outside anything this repo documents or tests.
- **Add authentication to the carrier first.** The honest fix and the reason `trusted-hosts` reads as a stopgap in its own JSDoc. It is a much larger design — credential storage, session lifetime, a login surface, its own threat model — and blocking a one-field deployment choice on it is what produced the fork patches.
- **A per-method allowlist** (`privilegedMethods: string[]`, say, letting a deployment admit `settings.describe` but not `credentials.set`). Refused: the set is one plane by design — reads are as privileged as writes, since describing returns the exposed configuration — so a partial opt-in invites a deployment to believe it kept a boundary it did not.
- **A boolean** (`allowRemoteConfiguration: true`). The named union says what the request is measured against; a boolean would leave "remote" undefined at exactly the moment the reader needs to know it means `trustedHosts` and nothing wider.
- **Deriving the mode from the bind host** (all-interfaces implies wide). Refused: reachability and trust are deliberately separate in this design, and inferring one from the other is how a deployment acquires an exposure it never wrote down.

## Consequences

An all-interfaces deployment that sets `privilegedAuthority: 'trusted-hosts'` serves the Models and Settings pages, credential entry, preset authoring and the directory picker to the authorities it declared. The same deployment left at the default keeps answering 403 there, and the sentence a user reads for the reason now names the field.

`host.pickDirectory` reaching a remote browser is honest about its own limit rather than newly broken: the native chooser opens on the Host's screen, which is why the adaptive picker already resolves `browse` under an all-interfaces bind ([directory picker adaptive default](../feature/2026-07-29-directory-picker-adaptive-default.md)). A deployment pinning the native picker and widening this field gets a dialog nobody is standing in front of.

Nothing about authentication changed, and the boundary note's threat model still governs both modes: cross-site requests, opaque origins and rebound Hosts are refused in `trusted-hosts` exactly as in `loopback`. Restoring a narrower posture is editing one field, not reverting a patch.

Widening this field is what made the settings wire's own redaction gap reachable from a network rather than from one machine, so the value guarantee had to become fail-closed first ([fail-closed secret redaction](2026-08-17-fail-closed-secret-redaction.md)). Serving the configuration plane to a network is only defensible because a secret can no longer ride a described value out.

## Testing

`packages/client/connection/tests/node-half.host.spec.ts` pins all three positions against one declared authority: the existing scenario keeps proving every privileged method 403s under the default while an ordinary read passes; its counterpart proves the same methods reach the carrier under `trusted-hosts` while an undeclared Host still 403s on them, so the widening is bounded by the fence rather than replacing it; and a third registers a generic channel and a shared interceptor with `authority: 'loopback'` under `trusted-hosts` and proves both still refuse the declared authority and run neither handler.
