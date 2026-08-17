# Agent Note: Fail-closed secret redaction for described settings

Status: implemented

English | [中文](2026-08-17-fail-closed-secret-redaction.zh.md)

## Problem

`redactSecrets` walked `object`, `dict`, and `array`, and its `default:` case returned the value verbatim. A `role('secret')` reachable only through a `union`, `intersect`, `transform`, or `tuple` therefore crossed the wire in full, with an empty `secrets` list and nothing recording the miss — the settings README named this and called a fail-closed `describeForWire()` the real answer, deferred.

A second path leaked without any unwalked container: `dsh-llm-pi-ai`'s profile `headers` was `z.dict(z.string())`, so an operator storing `Authorization: Bearer …` or `api-key` there had it returned by a redacted `describe()` and rendered by the configuration UI. The walker descends dicts correctly; there was simply no secret role to find, because a header value carries nothing that says it is a credential.

Both were tolerable while the configuration plane answered only a loopback Host. Making that plane's authorities configurable ([the configuration plane follows trustedHosts on request](2026-08-17-configuration-plane-authority.md)) turns each into a network-reachable credential read, and no authenticating proxy in front can fix a response that carries the secret.

## Decision

The walker fails closed on what it cannot descend. Its `default:` case now asks whether a secret role sits anywhere in the node's subtree, following every nesting relation (`inner`, `list`, `dict`); if one does, the subtree is withheld from the value and its path is reported in a new `unprovable` list. A scalar leaf still returns as it is, and so does a branch set with no secret in it — the discriminator is the subtree's contents, not the node's type, because a literal enum is the common `union` and failing closed on the type would withhold most configuration.

`tuple` joins the three containers the README named. It has the same gap for the same reason: the walker never descended `list`. Two further positions fail closed on the same question. A `lazy` child lives behind its `builder`, so the factory is called to ask whether a secret hides under it — a schemastery schema is callable, so the result reads as `function`, not `object`, and a builder that throws counts as hiding one. And a malformed value where a container belongs (a string where the dict should be) is withheld rather than passed through, because the walker cannot address the secret positions inside it; the same value under a schema with no secret in it still passes, which is what keeps ordinary malformed configuration visible to the form that has to fix it.

The serialized schema is a wire value too. `sanitizeSchemaEnvelope` detaches `schema.toJSON()` and drops `default` and `initial` from every `role: 'secret'` ref, and `describe` applies it under redaction, so a secret field's declared default no longer rides the envelope past value redaction. The envelope's `refs` table is flat, which is why this reaches even the secret nodes the value walker cannot: a node buried in a union branch is still its own ref.

`unprovable` is published rather than computed and dropped: it rides `SettingsDescriptor` and the wire view `SettingsNamespaceView`, omitted when empty, so a configuration surface can present such a namespace as not editable instead of trusting a value with silent holes.

`headers` becomes write-only on the wire: its element carries `role('secret')`, so a redacted `describe()` withholds every value while the key names ride the `secrets` sidecar, which is what lets a form render write-only inputs per header. Requests keep using the real values; only the described view is stripped. `apiKeyEnv` reference names stay readable, because a reference name is not a credential.

## Alternatives considered

- **Refuse the whole namespace when redaction cannot be proven.** The README's own framing, and the better product answer: a namespace served with a silent hole is confusing. It needs a wire field and a UI state to explain the refusal, which is a larger change than closing the leak; `unprovable` is published so that work can build on it without re-deriving the analysis.
- **Fail closed on the node type** (any `union`/`intersect`/`transform`/`tuple`). Refused: string-literal enums are unions, so this would withhold most of every configuration page while protecting nothing extra.
- **Keep the walker as it was and forbid such schemas by convention.** The status quo, and what the README asked of registrants. A convention is not enforcement — nothing rejected a schema that broke it, and the failure mode was a silent credential read.
- **Refuse only credential-looking header names** (`Authorization`, `api-key`, `x-api-key`). Refused: the allowlist is wrong on the next vendor's header name, and the value it protects is exactly the one nobody remembered to add.
- **Reject a `headers` entry that looks like a credential at config time.** Same brittleness, and it would refuse a legitimate deployment whose gateway genuinely needs a static header.

## Consequences

No described settings value can carry a `role('secret')` the redactor did not account for: it is either removed and enumerated in `secrets`, or its subtree is withheld and its position reported in `unprovable`. That holds for loopback callers too — a browser page is a wire whichever authority served it.

A configuration UI no longer shows existing header values for a pi-ai provider; it shows a write-only input per key. An operator who stored a credential in `headers` keeps a working route, and the credential stops being readable from the page. `apiKeyEnv` remains the way to name a credential that a form should show.

`RedactedValue` gains a required `unprovable` member, so every caller destructuring the result sees it. What remains deferred is refusal itself: withholding a subtree and reporting its position is not the same as refusing the namespace, and nothing today acts on `unprovable` beyond carrying it.

One channel stays open by construction and is recorded in the settings README: a key the schema does not declare rides the wire verbatim, because the object walker preserves keys outside the schema and nothing can classify what the schema never modeled. A credential belongs on a declared `role('secret')` field or behind an `apiKeyEnv`-style reference.

## Testing

`packages/settings/settings/tests/redact.spec.ts` proves the withholding on both unwalked shapes: a secret inside one `union` branch and a secret under a `transform` are absent from the value — asserted by searching the serialized value for the live string, not only by shape — and each reports its path in `unprovable`. A companion case pins the non-regression that makes the discriminator worth having: a literal-enum `union` beside a plain number is returned unchanged, with both `secrets` and `unprovable` empty.

Two more cases cover the positions found after the first pass: a secret behind a `lazy` builder is withheld while a `lazy` schema with nothing secret under it still returns its value, and a malformed value under the secret-bearing containers is withheld with both paths reported while the same malformation under a secret-free schema passes through. Descriptor-level cases pin the envelope and the published member: a secret's `.default(...)` is absent from the serialized schema of a redacted describe (including one declared inside a union branch) while an ordinary field's default survives, the unredacted internal read still carries it, and a namespace whose secret sits under a union reports `unprovable` while a clean namespace omits the member.

The `headers` guarantee is proven against the real schema rather than a fixture: composing `dsh-llm-pi-ai`'s exported `Config` with a provider whose `headers` hold `Authorization` and an ordinary `X-Org` entry, a redacted `describe` value contains neither string while the sidecar lists both key paths.

The assembled application closes the loop in `apps/web/tests/remote-configuration-plane.e2e.ts`: a canary credential seeded through the shipped settings provider's own write path must be absent from both the `settings.describe` body and the rendered DOM of the real Settings dialog, while the provider's public neighbours, its `apiKeyEnv` reference name, and the secret slots in the sidecar are all present — so the absence assertion cannot pass vacuously.
