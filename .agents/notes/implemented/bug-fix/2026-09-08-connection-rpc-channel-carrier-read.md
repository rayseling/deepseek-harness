# Agent Note: Register Connection RPC channels through a soft carrier read

Status: implemented

English | [中文](2026-09-08-connection-rpc-channel-carrier-read.zh.md)

## Problem

`fix: windows build` removed `webServer` from Connection's own `inject`, which became `['credentials']`, so the Electron host can provide Connection without an HTTP carrier. `HostConnectionService.register()` still read `owner.webServer` through the Cordis property accessor, which resolves the name against Connection's declarations rather than the caller's: a carrier provided from a sibling plugin fiber, as the Web bundles mount it, is unreachable, and the read throws `cannot get property "webServer" without inject` inside the registration effect. Every dedicated channel a feature plugin registered stayed unrouted: boot completed, and a POST to the channel fell through to the static server and answered 405. Upstream callers use only `rpc.intercept`, which needs no carrier, so the in-tree suite never observed it.

## Decision

This mirror carries one commit on top of upstream for it: `register()` reads the carrier with `owner.get('webServer')`, the strict global-store read that `packages/AGENTS.md` prescribes for a service a plugin does not inject, and registers the prefix route inside `owner.effect`, so the channel owner keeps the disposer. When no carrier is active at registration, it throws `connection: RPC channel "<channel>" needs a webServer carrier`.

`HostConnectionRpc.handle` documents that requirement, and `tests/node-half.host.spec.ts` covers both paths: with a carrier provided from its own plugin fiber, a consumer that reaches Connection through `ctx.inject(['connection'], …)` registers and removes a route, and a registration with no carrier throws the named error.

## Alternatives considered

**Add `webServer` back to Connection's `inject`.** The property read would resolve again, but Connection would then never activate in the Electron host, which provides no HTTP carrier.

**Register through `owner.inject(['webServer'], …)`.** The route would wait for a carrier and follow its restarts, but a channel registered where no carrier ever appears would stay unrouted without an error, whereas `register()` throws the named error to the code that registers the channel.

**Declare `webServer` in each channel owner's `inject`.** It does not make the read resolve: the accessor checks Connection's declarations, so a caller-side `inject` ends in the same error.

**Mount the carrier on an ancestor of Connection.** The accessor resolves a carrier that an ancestor context provides, as the root-provided test double shows, but the Web bundles mount `webserver` as an ordinary plugin row, and moving it would change the composition of every profile that serves the GUI.

## Consequences

A plugin must register its channel while the carrier is active, and a registration is not repeated on a carrier that later replaces that one. A registration that runs while no carrier is active throws the named error to the code that calls `rpc.handle`: in the entry plugin's own `apply`, the entry fails and the startup audit reports it as an entry that did not activate; inside a nested `ctx.inject(['connection'], …)` callback, only that child fiber fails, so the entry stays active, the startup audit does not report it, and a POST to the channel answers 405.

The fix is not upstream, and [discussion #5889](https://github.com/deepseek-ai/deepseek-harness/discussions/5889) reports the same defect.
