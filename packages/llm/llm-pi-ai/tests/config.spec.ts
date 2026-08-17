import { describe, expect, it } from 'vitest'
import type z from '@deepseek-ai/schemastery'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { assertServiceable, Config } from '../src/config.ts'

/** Validate one hand-declared route, with the caller's fields layered onto it. */
const routeWith = (profile: Record<string, unknown>): (() => unknown) =>
  () => Config({
    providers: {
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        ...profile,
      },
    },
  })

/** Validate that route with the caller's fields on its single model entry. */
const configWith = (model: Record<string, unknown>): (() => unknown) =>
  routeWith({ models: [{ id: 'm', ...model }] })

describe('reasoning schema boundary', () => {
  it('rejects a level pi-ai does not know at the write that produced it', () => {
    expect(configWith({ reasoningEfforts: { ultra: 'x' } })).toThrow(/"off"/)
    expect(configWith({ reasoningEfforts: { high: 42 } })).toThrow()
  })

  it('keeps false distinguishable from an absent declaration', () => {
    type Materialized = { providers: Record<string, { models?: { reasoningEfforts?: unknown }[] }> }
    const withFalse = configWith({ reasoningEfforts: false })() as Materialized
    expect(withFalse.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBe(false)
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBeUndefined()
  })

  it('rejects a thinking format outside the offered set', () => {
    expect(configWith({ compat: { thinkingFormat: 'quantum' } })).toThrow(/expected/)
  })
})

describe('modality schema boundary', () => {
  it('rejects a modality pi-ai does not know, at either level', () => {
    expect(configWith({ input: ['audio'] })).toThrow(/expected/)
    expect(routeWith({ defaultInput: ['text', 'audio'] })).toThrow(/expected/)
  })

  it('refuses a route whose models could accept nothing', () => {
    // The pair the settings seam runs: the schema accepts the empty list as
    // well-typed, and the namespace validator is what refuses it. Asserting
    // only the schema would report this route as writable.
    expect(routeWith({ defaultInput: [] })).not.toThrow()
    expect(() => { assertServiceable(routeWith({ defaultInput: [] })() as Config) })
      .toThrow(/defaultInput must name at least one modality/)
  })

  type Materialized = {
    providers: Record<string, { defaultInput?: unknown; models?: { input?: unknown }[] }>
  }

  it('materializes an absent entry list as empty and an absent route list as text', () => {
    // The empty-list inheritance rule exists because of exactly this: an entry
    // that declares nothing reaches resolution as `[]`, not as `undefined`.
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.input).toEqual([])
    expect(absent.providers['acme-gateway']?.defaultInput).toEqual(['text'])
  })
})

describe('headers on the settings wire', () => {
  it('withholds every header value from a redacted describe while naming the keys', () => {
    // The credential an operator can put here is indistinguishable from an
    // ordinary header by value, so the whole dict is write-only on the wire.
    const value = Config({
      providers: {
        'acme-gateway': {
          api: 'openai-completions',
          baseURL: 'https://acme.test',
          models: [{ id: 'm' }],
          headers: { Authorization: 'Bearer live-token', 'X-Org': 'org-1' },
        },
      },
    })
    const redacted = redactSecrets(Config as unknown as z<never>, value)
    const serialized = JSON.stringify(redacted.value)
    expect(serialized).not.toContain('live-token')
    expect(serialized).not.toContain('org-1')
    expect(redacted.secrets.filter(secret => secret.path.includes('headers'))).toEqual([
      { path: ['providers', 'acme-gateway', 'headers', 'Authorization'], set: true },
      { path: ['providers', 'acme-gateway', 'headers', 'X-Org'], set: true },
    ])
    // Nothing in this schema hides a secret where the walker cannot reach it.
    expect(redacted.unprovable).toEqual([])
  })
})
