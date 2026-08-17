# Agent Note: The configuration plane follows trustedHosts on request

Status: implemented

English | [中文](2026-08-17-configuration-plane-authority.zh.md)

## Problem

The privileged method set — `settings.*`, `credentials.*`, `llm.discoverModels`, `host.pickDirectory`/`openPath`, and the agent-preset authoring methods — passed the `/api` trust fence with an empty trust list, so only a loopback Host reached it. That is the posture [the api browser-trust boundary](2026-07-28-api-browser-trust-boundary.md) chose, on the reasoning that `trustedHosts` is a DNS-rebinding defense rather than authentication, and it hard-coded the choice: the empty list was a literal at three call sites, with no way for a deployment to decide otherwise.

That leaves an all-interfaces deployment half usable and gives its operator nothing to weigh. A remote browser converses and runs tools — `session.prompt` drives an agent that runs bash, which is the most consequential method on the surface and was never pinned — but the Models page cannot render, because `settings.describe` answers 403 and the client reports `transport failure for /api/settings.describe: HTTP 403`. So the boundary refused the reads that let someone configure a provider while admitting the method that executes arbitrary commands, and the only remedies were to re-reach the machine some other way (an SSH tunnel, a Host-rewriting proxy) or to patch the pin out of a fork.

## Decision

`client-connection` takes `privilegedAuthority: 'loopback' | 'trusted-hosts'`, defaulting to `loopback`. The default reproduces the previous behaviour exactly, so no shipped composition changes; `trusted-hosts` passes the deployment's own `trustedHosts` to the same fence the ordinary methods already pass.

The mode resolves once in `apply()` into one `privilegedHosts` list, and all three enforcement points read it: the `/api` privileged-method check, and both places `authority: 'loopback'` is honoured for a generic Connection channel (the shared-channel interceptor and a registered channel's own route). Splitting them would be a half-open door — one plane admitting a remote caller the other refuses — so the value is computed in one place and threaded, not re-derived.

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

## Testing

`packages/client/connection/tests/node-half.host.spec.ts` pins both modes against one declared authority: the existing scenario keeps proving every privileged method 403s under the default while an ordinary read passes, and its counterpart proves the same methods reach the carrier under `trusted-hosts` while an undeclared Host still 403s on them — so the widening is bounded by the fence rather than replacing it.
