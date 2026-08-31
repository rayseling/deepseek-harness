# Agent Note: Host-backed settings on every authenticated page

Status: implemented

English | [中文](2026-08-31-host-settings-on-every-authenticated-page.zh.md)

## Problem

Upstream resolves the settings persistence mode from the page hostname: a page served from loopback gets `host`, and every other authority gets `memory`. The describe mirror is the browser's only `settings.describe` reader, and in `memory` mode `load()` and `ensure()` return without a wire call. A page opened through a LAN address therefore never reads settings: every shared form reports unavailable, the Models page shows `settings are unavailable in this browser` instead of the provider catalog, the plugin settings tab has nothing to render, and Appearance, Language, busy-Enter, and onboarding acknowledgement stay process-local. This mirror serves its Web UI to other devices on a home network, where that mode leaves the Settings dialog unusable.

## Decision

This mirror carries one commit on top of upstream for it: `dsh-client-ui-settings` resolves persistence to `host` for every page (`const persistence = 'host'` in `src/client/index.ts`) and hands that value to `SettingsDescribeMirror` and to every shared form that `ConfigForms` creates. A page on any authority reads and writes settings through the Host.

Authorization stays with Connection: every `/api` call and the WebSocket upgrade pass the trusted-host fence and require the signed browser-session cookie, and answer 401 without it. Field roles still redact secrets in `settings.describe`.

The Host methods that act on the Host's desktop — `settings/openSettingsDocument`, `session/openWorkspacePath`, and the deliverables `/api/present.open` route — have no origin check in upstream or in this mirror, so any page that holds a browser session can call them. `dsh-client-ui-settings-general` omits its **Open configuration file** action off loopback; that hides the control and enforces nothing on the Host.

`memory` mode remains in `SettingsDescribeMirror` and `ConfigFormController` without a shipped selector, so the one-line change rebases without touching their signatures. This is a deliberate exception to the package rule that every option needs a current consumer: removing the mode would rewrite both classes, their specs, and their upstream callers on every rebase, while keeping it leaves restoring upstream behavior a one-line revert.

This note supersedes the loopback-only scope stated in the [Host-backed preferences note](../bug-fix/2026-08-06-host-backed-web-preferences.md), which still owns the preference schemas, the mirror lifecycle, and the write ordering.

## Alternatives considered

**Keep the loopback rule and reach the GUI through a port forward on each device.** Every phone and laptop would need a tunnel to open Settings, while the rest of the GUI already works over the authenticated LAN address.

**Add a `Config` field that selects the mode per deployment.** Upstream convention prefers a validated field for a deployment choice, but the field would add a schema, bundle wiring, and documentation across several upstream files, and every rebase would carry them. This mirror serves one deployment.

**Add Host-side origin checks to the desktop actions.** A page that holds a browser session already runs shell commands through the agent, so an origin check on the file-open methods would protect nothing that the session cannot reach another way.

## Consequences

On a network-reachable deployment, anyone holding a browser session can read and write every registered settings namespace, including model provider routes; secret values stay redacted. Every device reads and writes the same Host document, so a language, theme, font-size, or onboarding choice made on one device applies to every other device, and the last write wins. Each page issues two describe reads at startup, as loopback pages already do.

The `tests/apply` specs of `ui-settings-general`, `ui-settings-models`, and `ui-theme`, and the `ui-settings` developer-tools spec, assert `host` persistence on a non-loopback page and fail when the hostname selector returns. The `apps/web/tests/remote-welcome.e2e.ts` scenario acknowledges the welcome notice on a non-loopback page and asserts that the Host document holds the acknowledgement and that the notice stays dismissed after reload. The consumer package READMEs (`locale`, `ui-theme`, `ui-settings`, `ui-settings-models`, `ui-settings-general`, `ui-chat`) and the preference notes that described remote pages as process-local (performance and usage, developer tools, developer tools default on) describe this policy, and the root README's disclosure block states it for readers of the mirror.
