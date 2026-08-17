import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { redactSecrets, settingsNamespace } from '../src/index.ts'
import { MemorySettings } from './memory.ts'

const Profile = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
})

const Adapter: z<object> = z.object({
  apiKey: z.string().role('secret'),
  providers: z.dict(Profile),
  fallbacks: z.array(Profile),
  nested: z.object({
    token: z.string().role('secret'),
  }),
})

describe('redactSecrets', () => {
  it('strips secrets from object, dict, and array containers and records each position', () => {
    const { value, secrets } = redactSecrets(Adapter as z<never>, {
      apiKey: 'top-secret',
      providers: {
        openai: { apiKey: 'sk-live', apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://x' },
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      fallbacks: [{ apiKey: 'fb', baseURL: 'https://y' }],
      nested: {},
    })
    expect(value).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://x' },
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      fallbacks: [{ baseURL: 'https://y' }],
      nested: {},
    })
    expect(secrets).toEqual([
      { path: ['apiKey'], set: true },
      { path: ['providers', 'openai', 'apiKey'], set: true },
      { path: ['providers', 'anthropic', 'apiKey'], set: false },
      { path: ['fallbacks', '0', 'apiKey'], set: true },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('enumerates unset object-property slots without inventing containers', () => {
    const { value, secrets } = redactSecrets(Adapter as z<never>, undefined)
    expect(value).toBeUndefined()
    expect(secrets).toEqual([
      { path: ['apiKey'], set: false },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('never mutates the input and preserves keys outside the schema', () => {
    const input = Object.freeze({
      apiKey: 'frozen',
      extra: Object.freeze({ keep: true }),
    })
    const { value } = redactSecrets(Adapter as z<never>, input)
    expect(input.apiKey).toBe('frozen')
    expect(value).toEqual({ extra: { keep: true }, nested: undefined } as never)
    expect((value as { extra: unknown }).extra).toEqual({ keep: true })
  })

  it('withholds a malformed value under a secret-bearing container', () => {
    // The schema's dict and array both hold secrets, so a value the walker
    // cannot descend cannot be proven free of them and must not pass.
    const { value, secrets, unprovable } = redactSecrets(Adapter as z<never>, {
      providers: 'sk-live-hiding-in-a-string',
      fallbacks: 'not-an-array',
    })
    expect(JSON.stringify(value)).not.toContain('sk-live-hiding-in-a-string')
    expect(value).toEqual({})
    expect(unprovable).toEqual([['providers'], ['fallbacks']])
    expect(secrets).toEqual([
      { path: ['apiKey'], set: false },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('passes a malformed value through where the schema holds no secret', () => {
    const Plain = z.object({ tags: z.dict(z.string()), extras: z.array(z.number()) })
    const { value, secrets, unprovable } = redactSecrets(Plain as z<never>, {
      tags: 'not-a-dict',
      extras: 'not-an-array',
    })
    expect(value).toEqual({ tags: 'not-a-dict', extras: 'not-an-array' })
    expect(secrets).toEqual([])
    expect(unprovable).toEqual([])
  })

  it('sees a secret behind a lazy schema and withholds the value', () => {
    const Lazy = z.object({ auth: z.lazy(() => z.object({ token: z.string().role('secret') })) })
    const { value, unprovable } = redactSecrets(Lazy as z<never>, { auth: { token: 'live-secret' } })
    expect(JSON.stringify(value)).not.toContain('live-secret')
    expect(unprovable).toEqual([['auth']])

    const LazyPlain = z.object({ meta: z.lazy(() => z.object({ label: z.string() })) })
    const plain = redactSecrets(LazyPlain as z<never>, { meta: { label: 'visible' } })
    expect(plain.value).toEqual({ meta: { label: 'visible' } })
    expect(plain.unprovable).toEqual([])
  })

  it('treats a secret-role container as one opaque secret leaf', () => {
    const Weird = z.object({ blob: z.object({ inner: z.string() }).role('secret') })
    const { value, secrets } = redactSecrets(Weird as z<never>, { blob: { inner: 'x' } })
    expect(value).toEqual({})
    expect(secrets).toEqual([{ path: ['blob'], set: true }])
  })

  it('drops a dict entry whose entire value is the secret', () => {
    const Tokens = z.object({ tokens: z.dict(z.string().role('secret')) })
    const { value, secrets } = redactSecrets(Tokens as z<never>, { tokens: { a: 'x', b: 'y' } })
    expect(value).toEqual({ tokens: {} })
    expect(secrets).toEqual([
      { path: ['tokens', 'a'], set: true },
      { path: ['tokens', 'b'], set: true },
    ])
  })

  it('withholds a secret the walker cannot reach through a union or transform', () => {
    // The walker cannot say which branch a concrete value took, so a secret
    // anywhere under one is withheld rather than returned verbatim.
    const Union = z.object({
      auth: z.union([z.object({ token: z.string().role('secret') }), z.object({ anonymous: z.boolean() })]),
    })
    const union = redactSecrets(Union as z<never>, { auth: { token: 'live-secret' } })
    expect(JSON.stringify(union.value)).not.toContain('live-secret')
    expect(union.value).toEqual({})
    expect(union.unprovable).toEqual([['auth']])
    expect(union.secrets).toEqual([])

    const Transformed = z.object({
      auth: z.transform(z.object({ token: z.string().role('secret') }), inner => inner),
    })
    const transformed = redactSecrets(Transformed as z<never>, { auth: { token: 'live-secret' } })
    expect(JSON.stringify(transformed.value)).not.toContain('live-secret')
    expect(transformed.unprovable).toEqual([['auth']])
  })

  it('returns a branch set holding no secret as it is', () => {
    // Literal enums are the common union; failing closed on the node type
    // rather than on its contents would withhold most configuration.
    const Enum = z.object({ mode: z.union(['fast', 'slow'] as const), count: z.number() })
    const { value, secrets, unprovable } = redactSecrets(Enum as z<never>, { mode: 'fast', count: 2 })
    expect(value).toEqual({ mode: 'fast', count: 2 })
    expect(secrets).toEqual([])
    expect(unprovable).toEqual([])
  })

  it('tolerates structural nodes missing their relation maps', () => {
    expect(redactSecrets({ type: 'dict' } as never, { k: 'v' }))
      .toEqual({ value: { k: 'v' }, secrets: [], unprovable: [] })
    expect(redactSecrets({ type: 'object' } as never, { k: 'v' }))
      .toEqual({ value: { k: 'v' }, secrets: [], unprovable: [] })
    expect(redactSecrets({ type: 'array' } as never, ['v']))
      .toEqual({ value: ['v'], secrets: [], unprovable: [] })
  })
})

describe('describe() layers and redaction', () => {
  const NS = settingsNamespace('adapter')

  async function boot(doc?: Record<string, unknown>) {
    const ctx = new Context()
    await ctx.plugin(MemorySettings, doc === undefined ? undefined : { doc })
    return ctx
  }

  it('exposes detached base and user layers beside the resolved value', async () => {
    const ctx = await boot({ adapter: { baseURL: 'https://user' } })
    const base = { apiKey: 'entry-key', baseURL: 'https://base' }
    ctx.settings.register(NS, Profile, { base })
    const [descriptor] = ctx.settings.describe()
    expect(descriptor?.base).toEqual(base)
    expect(descriptor?.base).not.toBe(base)
    expect(descriptor?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.value).toEqual({ apiKey: 'entry-key', baseURL: 'https://user' })
    ;(descriptor?.user as Record<string, unknown>).baseURL = 'mutated'
    expect(ctx.settings.describe()[0]?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.secrets).toBeUndefined()
  })

  it('omits the layers when neither a base nor a user section exists', async () => {
    const ctx = await boot()
    ctx.settings.register(NS, Profile)
    const [descriptor] = ctx.settings.describe()
    expect(descriptor).not.toHaveProperty('base')
    expect(descriptor).not.toHaveProperty('user')
  })

  it('describes a section that became malformed after registration as having no user layer', async () => {
    const ctx = await boot({ adapter: { baseURL: 'https://user' } })
    const provider = ctx.get('settings') as MemorySettings
    ctx.settings.register(NS, Profile, { base: { baseURL: 'https://base' } })
    provider.pushExternal({ adapter: 5 })
    const [descriptor] = ctx.settings.describe()
    expect(descriptor).not.toHaveProperty('user')
    // The malformed publish kept the last good resolved value.
    expect(descriptor?.value).toEqual({ baseURL: 'https://user' })
  })

  it('redacts a descriptor that has neither base nor user layer', async () => {
    const ctx = await boot()
    ctx.settings.register(NS, Profile)
    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
    expect(descriptor).not.toHaveProperty('base')
    expect(descriptor).not.toHaveProperty('user')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: false }])
  })

  it('redacts every layer and enumerates secret slots under redactSecrets', async () => {
    const ctx = await boot({ adapter: { apiKey: 'user-key', baseURL: 'https://user' } })
    ctx.settings.register(NS, Profile, { base: { apiKey: 'entry-key' } })
    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
    expect(descriptor?.value).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.base).toEqual({})
    expect(descriptor?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    const [verbatim] = ctx.settings.describe()
    expect(verbatim?.value).toEqual({ apiKey: 'user-key', baseURL: 'https://user' })
  })
})

describe('wire descriptor hardening', () => {
  const NS = settingsNamespace('hardened')

  it('sanitizes a secret default out of the serialized schema envelope', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    const Schema = z.object({
      apiKey: z.string().role('secret').default('ENVELOPE_SECRET'),
      pick: z.union([z.object({ token: z.string().role('secret').default('BRANCH_SECRET') }), z.const('none')]),
      url: z.string().default('https://plain'),
    })
    ctx.settings.register(NS, Schema)
    const [redacted] = ctx.settings.describe({ redactSecrets: true })
    const envelope = JSON.stringify(redacted?.schema)
    expect(envelope).not.toContain('ENVELOPE_SECRET')
    expect(envelope).not.toContain('BRANCH_SECRET')
    expect(envelope).toContain('https://plain')
    // The unredacted internal read keeps the live schema untouched.
    const [plain] = ctx.settings.describe()
    expect(JSON.stringify(plain?.schema)).toContain('ENVELOPE_SECRET')
  })

  it('reports unprovable positions on the redacted descriptor', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings, { doc: { hardened: { pick: { token: 'USER_SECRET' } } } })
    const Schema = z.object({
      pick: z.union([z.object({ token: z.string().role('secret') }), z.const('none')]),
    })
    ctx.settings.register(NS, Schema)
    const [redacted] = ctx.settings.describe({ redactSecrets: true })
    expect(JSON.stringify(redacted?.value ?? {})).not.toContain('USER_SECRET')
    expect(JSON.stringify(redacted?.user ?? {})).not.toContain('USER_SECRET')
    expect(redacted?.unprovable).toEqual(expect.arrayContaining([['pick']]))
    // The clean namespace shape omits the member entirely.
    const clean = new Context()
    await clean.plugin(MemorySettings)
    clean.settings.register(NS, z.object({ url: z.string() }))
    expect(clean.settings.describe({ redactSecrets: true })[0]).not.toHaveProperty('unprovable')
  })
})
