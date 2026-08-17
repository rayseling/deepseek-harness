import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/index.ts'

describe('remoteConfiguration capability', () => {
  it('registers with the api proxy and reports the widened policy', async () => {
    const ctx = new Context()
    ctx.provide('webServer', { register: () => () => {}, registerUpgrade: () => () => {} } as never)
    let provider: (() => boolean) | undefined
    ctx.provide('apiProxy', {
      provideRemoteConfiguration(next: () => boolean) {
        provider = next
        return () => { provider = undefined }
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      trustedHosts: ['harness.example'],
      privilegedAuthority: 'trusted-hosts',
    })
    await fiber.await()
    expect(typeof provider).toBe('function')
    expect(provider?.()).toBe(true)
    await fiber.dispose()
    expect(provider).toBeUndefined()
  })

  it('reports false under the default posture', async () => {
    const ctx = new Context()
    ctx.provide('webServer', { register: () => () => {}, registerUpgrade: () => () => {} } as never)
    let provider: (() => boolean) | undefined
    ctx.provide('apiProxy', {
      provideRemoteConfiguration(next: () => boolean) { provider = next; return () => {} },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    await fiber.await()
    expect(provider?.()).toBe(false)
    await fiber.dispose()
  })

  it('registers with an api proxy that settles after this plugin applies', async () => {
    const ctx = new Context()
    ctx.provide('webServer', { register: () => () => {}, registerUpgrade: () => () => {} } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      trustedHosts: ['harness.example'],
      privilegedAuthority: 'trusted-hosts',
    })
    await fiber.await()
    // The proxy arrives as its own plugin afterwards, the way a sibling row
    // settling later in the same composition does.
    let provider: (() => boolean) | undefined
    class LateProxy extends Service {
      constructor(context: Context) {
        super(context, 'apiProxy')
      }

      provideRemoteConfiguration(next: () => boolean): () => void {
        provider = next
        return () => { provider = undefined }
      }
    }
    const proxyFiber = ctx.plugin(LateProxy)
    await proxyFiber.await()
    expect(typeof provider, 'a later-settled proxy must still receive the provider').toBe('function')
    expect(provider?.()).toBe(true)
    await fiber.dispose()
  })
})
