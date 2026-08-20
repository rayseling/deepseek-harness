/**
 * The settings domain base plugin's own mounting behavior: it stands up
 * `ctx.settingsScope` over one shared describe mirror, keeps that mirror
 * fresh on settings-document and connection-reset invalidations, and retires
 * both the service and the subscriptions with its fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { SettingsSchemaService } from '../src/client/schema.ts'
import { SettingsScopeBinder } from '../src/client/settings-scope.ts'

/** Boot the browser half over a fake connection and test remote. */
function bench(configurable: () => boolean = () => true) {
  const describeCall = vi.fn().mockResolvedValue({
    rpcId: 'plugin-bench' as never,
    result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [] } },
  })
  const ctx = new Context()
  // The Host description drives the mirror's authority, so the bench keeps the
  // listener to publish a handshake the way the connection loop does.
  let publishDescription = (): void => {}
  ctx.provide('connection', {
    api: { settings: { describe: describeCall } },
    isLoopback: configurable(),
    canConfigure: configurable,
    hostDescription: {
      getSnapshot: () => undefined,
      subscribe: (listener: () => void) => { publishDescription = listener; return () => {} },
    },
  } as never)
  new TestRemote(ctx)
  return {
    ctx,
    describeCall,
    publishDescription: () => { publishDescription() },
    fiber: ctx.plugin({ inject: [...inject], apply }),
  }
}

describe('settings domain base plugin', () => {
  it('mounts the scope service under settingsScope and reads once eagerly', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    expect(ctx.get('settingsScope')).toBeInstanceOf(SettingsScopeBinder)
    expect(ctx.get('settingsSchema')).toBeInstanceOf(SettingsSchemaService)
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
  })

  it('refreshes the mirror on document commits and connection resets, once each', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(2) })
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(3) })
  })

  it('reads once the handshake reports the deployment widened its configuration plane', async () => {
    let configurable = false
    const { describeCall, publishDescription, fiber } = bench(() => configurable)
    await fiber.await()
    // A remote page starts process-local: no Host read at all.
    await Promise.resolve()
    expect(describeCall).not.toHaveBeenCalled()

    // A description that leaves the authority unchanged must not cost a read.
    publishDescription()
    await Promise.resolve()
    expect(describeCall).not.toHaveBeenCalled()

    configurable = true
    publishDescription()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
  })

  it('fiber disposal retires the service and its invalidation subscriptions', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    await fiber.dispose()
    expect(ctx.get('settingsScope')).toBeUndefined()
    expect(ctx.get('settingsSchema')).toBeUndefined()
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    ctx.emit('connection/reset')
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(1)
  })
})
