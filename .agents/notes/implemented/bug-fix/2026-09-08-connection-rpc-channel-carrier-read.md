# Agent Note: Register Connection RPC channels on the active carrier

Status: implemented

English | [中文](2026-09-08-connection-rpc-channel-carrier-read.zh.md)

## Problem

`fix: windows build` removed `webServer` from Connection's own `inject`, which became `['credentials']`, so the Electron host can provide Connection without an HTTP carrier. `HostConnectionService.register()` still read `owner.webServer` through the Cordis property accessor, which resolves the name against Connection's declarations rather than the caller's: a carrier provided from a sibling plugin fiber, as the Web bundles mount it, is unreachable, and the read throws `cannot get property "webServer" without inject` inside the registration effect. Every dedicated channel a feature plugin registered stayed unrouted: boot completed, and a POST to the channel fell through to the static server and answered 405. Upstream callers use only `rpc.intercept`, which needs no carrier, so the in-tree suite never observed it.

## Decision

This mirror carries one commit on top of upstream for it. `register()` first claims the channel in Connection's own channel set, so registering a channel that is already registered throws `connection: RPC channel "<channel>" is already registered` to the caller. It then registers the prefix route inside `owner.inject(['webServer'], …)`: that child fiber of the channel owner registers the route whenever a `webServer` carrier becomes active, including a carrier that starts after the registration or replaces a restarted one, and its disposal removes the route. The returned disposer disposes the child fiber and releases the claim; disposing the owner does the same. The child fiber reads the carrier with `webCtx.get('webServer')`, the strict global-store read that `packages/AGENTS.md` prescribes, because the child context keeps Connection's shadow and its property accessor would throw the same `without inject` error. Connection's own `/api` route follows the carrier through the same kind of injection.

`HostConnectionRpc.handle` documents the carrier dependency. `tests/node-half.host.spec.ts` provides the carrier from its own plugin fiber and registers through a consumer that reaches Connection with `ctx.inject(['connection'], …)`; it covers registration and removal, a carrier mounted after the registration, a restarted carrier, removal when the owner is disposed, and re-registration of a released channel. The upstream specs that register on a root-provided carrier wait for the route, because it lands on the carrier asynchronously, and their duplicate check expects Connection's error.

## Alternatives considered

**Add `webServer` back to Connection's `inject`.** The property read would resolve again, but Connection would then never activate in the Electron host, which provides no HTTP carrier.

**Read the carrier once with `owner.get('webServer')` and throw when none is active.** The route would never reach a carrier that starts after the registration or replaces a restarted one, so a carrier restart would leave the channel answering 405. The throw would also fail only the child fiber when the registration runs inside a nested `ctx.inject(['connection'], …)` callback, which the startup audit does not report.

**Declare `webServer` in each channel owner's `inject`.** It does not make the read resolve: the accessor checks Connection's declarations, so a caller-side `inject` ends in the same error.

**Mount the carrier on an ancestor of Connection.** The accessor resolves a carrier that an ancestor context provides, as the root-provided test double shows, but the Web bundles mount `webserver` as an ordinary plugin row, and moving it would change the composition of every profile that serves the GUI.

## Consequences

`rpc.handle` returns before the route lands on the carrier, so a request in that interval answers from the static fallback. A channel registered while no carrier is active stays unrouted until one becomes active; in the Electron host, which provides no HTTP carrier, a dedicated channel is never routed. Connection detects duplicates only among its own channels: a prefix route that another plugin registers directly on the carrier under the same path fails only the channel's child fiber, which the logger reports.

The fix is not upstream, and [discussion #5889](https://github.com/deepseek-ai/deepseek-harness/discussions/5889) reports the same defect.
