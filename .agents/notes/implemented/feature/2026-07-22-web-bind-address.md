# Agent Note: Explicit web bind address

Status: implemented

English | [中文](2026-07-22-web-bind-address.zh.md)

## Problem

`dsh web` binds every network interface even when its browser runs on the same machine. Local use therefore exposes an unauthenticated development server without an explicit operator choice, while remote-container and LAN-browser use still needs a supported way to accept non-loopback connections.

The HTTP carrier also hides the bind address inside `startWebServer()`, so alternate shells cannot state their own network policy at the package boundary.

## Decision

`dsh web` binds `127.0.0.1` by default. All-interface mode is the webserver row's `host: '0.0.0.0'`, enabled through a profile patch or a programmatic composition; the CLI itself now refuses `--host 0.0.0.0` as a usage error until remote access has an authentication layer, and rejects every other value so its network modes remain a small, deliberate contract. All-interface mode keeps printing the loopback URL and, when available, the first external IPv4 URL — and a browser on that URL can boot, since ids mint without a secure context ([insecure-origin uuid minting](../bug-fix/2026-08-17-insecure-origin-uuid-minting.md)).

`WebServerOptions.host` is required. The HTTP carrier passes that value to `node:http` without supplying a fallback, leaving each shell responsible for its bind policy. Programmatic carrier consumers may select another hostname or address directly.

## Alternatives considered

**Keep `0.0.0.0` as the default.** Rejected because ordinary same-machine use does not need network-wide reachability and should not acquire it implicitly.

**Use a boolean exposure flag.** Rejected because `--host 0.0.0.0` names the resulting socket behavior directly and matches the underlying server option without introducing a second term.

**Default inside `startWebServer()`.** Rejected because the carrier has multiple possible shells and no basis for choosing their deployment policy. Requiring `host` makes the choice visible at every assembly call.

## Consequences

Local `dsh web` starts remain reachable at `http://127.0.0.1:3080`; a browser on another machine must opt in by patching the webserver row to `host: '0.0.0.0'` — the CLI flag is refused. The CLI does not expose all-interface, custom interface address, or IPv6 modes, while programmatic carrier consumers retain that flexibility. Server tests pin both loopback and all-interface forwarding into the Node listen boundary, and the web smoke continues to exercise the default CLI path.
