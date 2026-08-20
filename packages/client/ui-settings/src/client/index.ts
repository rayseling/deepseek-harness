/**
 * Settings domain base plugin, browser half. Provides `ctx.settingsScope`, the
 * settings-namespace scope service every preference row binds its durable
 * section through, and owns the one `settings.describe` reader in the browser:
 * the describe mirror, whose invalidation subscriptions
 * (`settings/document-updated`, `connection/reset`) live here so every derived
 * surface refreshes from a single wire read. It depends on no `ui-*`
 * presentation package, so any feature that owns a preference can reach it:
 * the settings SHELL — the `sidebar.settings` occupant, its navigation, and
 * the chrome — lives in ui-settings-general, because a shell dependency on
 * ui-sidebar would close a reference cycle through ui-layout and ui-theme.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only pair supplying `$on` and its key face without dragging a build
// artifact into the Host graph (rationale beside the same pair in
// settings-scope.ts).
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import type {} from '@deepseek-ai/dsh-settings/types'
import { SettingsSchemaService } from './schema.ts'
import { SettingsScopeBinder } from './settings-scope.ts'
import { SettingsDescribeMirror } from './settings-mirror.ts'

export type {
  SettingsGeneralItemOwnerProps, SettingsHeaderOwnerProps, SettingsOnboardingOwnerProps,
  SettingsPluginsTabOwnerProps, SettingsSectionOwnerProps, SettingsTriggerOwnerProps,
} from './contract/slots.ts'
export type { SettingsScopeController, SettingsScopeBinder } from './settings-scope.ts'
export type { SettingsSchemaService } from './schema.ts'
export type { SchemaNode } from './schema.ts'
export type { SettingsDescribeFace, SettingsDescribeView, SettingsMirrorSnapshot } from './settings-mirror.ts'

/**
 * Required services: the wire handle for the mirror's reads and the forwarded
 * settings invalidation the mirror refreshes on.
 */
export const inject = ['connection', 'remote']

/**
 * Provide the settings-namespace scope service over one shared describe
 * mirror, and keep that mirror fresh on the three signals that can move the
 * settings document or this page's authority over it: a document commit, a
 * (re)connect, and a Host description carrying the configuration-plane answer.
 *
 * Constructing the service in this plugin's fiber keeps its traced methods
 * bound to each consuming plugin's context.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const schema = new SettingsSchemaService(ctx)
  const connection = ctx.get('connection') as ConnectionHandle
  const mirror = new SettingsDescribeMirror(
    connection.api,
    () => connection.canConfigure() ? 'host' : 'memory',
  )
  ctx.effect(() => {
    const disposers = [
      (ctx.get('remote') as ClientContext['remote']).$on('settings/document-updated', () => { void mirror.load() }),
      ctx.on('connection/reset', () => { void mirror.load() }),
      // A remote page learns whether the deployment answers it the
      // configuration plane only from the handshake, which lands after this
      // apply. adoptMode, not load: an unchanged authority must not turn every
      // description generation into a settings read.
      connection.hostDescription.subscribe(() => { mirror.adoptMode() }),
    ]
    // The first connection also emits connection/reset, so startup normally
    // costs two reads (budgeted in startup-rpc-budget.e2e.ts). The in-flight
    // fold does not merge them into one; it guarantees at most one pending
    // read at a time and that no invalidation arriving mid-read is lost.
    void mirror.ensure()
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings: describe mirror invalidations')
  new SettingsScopeBinder(ctx, { mirror, schema })
}
