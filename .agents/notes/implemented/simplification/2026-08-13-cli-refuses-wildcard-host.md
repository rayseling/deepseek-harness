# Agent Note: The CLI refuses the wildcard bind host

Status: implemented

English | [中文](2026-08-13-cli-refuses-wildcard-host.zh.md)

## Problem

`dsh web --host 0.0.0.0` was an advertised flag: the option help read "bind host; pass 0.0.0.0 to reach it from another machine", and an example line offered "reach it from another machine on the LAN" ([web bind address](../feature/2026-07-22-web-bind-address.md) is the decision that added it).

What the flag actually produced is a carrier with no authentication layer listening on every interface. The `/api` surface includes `session.prompt`, which drives an agent that runs bash, and the `/api` Host fence is a confused-deputy defense rather than an auth layer ([api browser-trust boundary](../architecture/2026-07-28-api-browser-trust-boundary.md)). A one-word flag was therefore the shortest path in the product to handing remote code execution to a network, offered in help text as the ordinary way to reach the GUI from a phone.

## Decision

The launcher refuses the wildcard value, not the flag. `--host <host>` is still declared and still resolves every other value, while `web-startup` rejects exactly `0.0.0.0` as a usage error before publishing `webStartup`, so nothing binds. What `dsh --profile web --help` loses is the wildcard guidance: the option's own text drops from "bind host; pass 0.0.0.0 to reach it from another machine" to "bind host", and the `--host 0.0.0.0` example line ("reach it from another machine on the LAN") is deleted. The refusal message names the reason and the alternative rather than only the constraint: all-interfaces binding "would expose remote code execution to the network; use 127.0.0.1 instead".

All-interface binding itself is untouched. `dsh-host-webserver`'s `host` schema still accepts `'0.0.0.0'`, so a deployment that wants it sets the `webserver` row's `config.host` through a profile patch or a programmatic composition, and the Web runtime still derives that machine's LAN IPv4 literals into the connection row's `trustedHosts` so the resulting LAN URL passes the Host fence. What changed is who makes the choice: a composition author editing a config file, not a flag a help screen recommends.

This supersedes the CLI half of [web bind address](../feature/2026-07-22-web-bind-address.md). That note's carrier-level decisions — `WebServerOptions.host` required with no fallback, the loopback default, the printed loopback and external URLs — all still hold.

## Alternatives considered

- **Keeping the flag with a printed warning.** Refused: a warning on a flag whose whole purpose is network exposure does not change what the operator got, and the help text would still be recommending it.
- **Keeping the flag behind a confirmation prompt.** A prompt cannot reach the non-interactive invocations that most need the guard (a supervisor, a container entrypoint), and those are exactly the deployments that would bind wide and stay up.
- **Shipping authentication first, then keeping the flag.** The honest fix, and still the condition for restoring it; deferring the refusal until then leaves the exposure in the product in the meantime.
- **Accepting other interface addresses instead** (a specific LAN IP rather than the wildcard). Same exposure with a narrower blast radius, but it needs the same authentication story and adds a second network mode to the CLI's contract for no safety gain.

## Consequences

`dsh web` reaches a browser on another machine only through a composition that opts in. The CLI's flag family is unchanged — `--host`, `--port`, and `--trusted-host` — and only one `--host` value is gone. An operator who followed the old help text gets a usage error naming the reason, not a silent loopback bind.

A browser on such a deployment does boot: ids mint without a secure context ([insecure-origin uuid minting](../bug-fix/2026-08-17-insecure-origin-uuid-minting.md)), which is a separate defect this decision predates. The privileged-method default still keeps the configuration plane loopback-only there, so a remote browser can converse and run tools but not reconfigure the deployment.

Restoring a CLI flag for all-interfaces binding is conditional on an authentication layer for the Web carrier, which the connection package records as deferred work.

## Testing

`packages/bundle/web-app/tests/startup.spec.ts` pins the refusal: `--host 0.0.0.0` exits as a usage error with the message above and provides no `webStartup`, while another `--host` value still resolves. The composition path stays covered by the webserver package's own listen tests, which pin both loopback and all-interface forwarding into the Node listen boundary.
