/**
 * The configuration plane's authority, proven through the assembled Web
 * composition: one remote authority reaching the same built server twice —
 * once under the default posture, once with the deployment opt-in — so the
 * difference is the composed `connection` row's `privilegedAuthority` and
 * nothing else.
 *
 * The browser resolves `*.localhost` to loopback while sending that name as
 * `Host`, which is what makes a real non-loopback authority testable against a
 * server bound to 127.0.0.1.
 *
 * Each case owns its scaffold start-to-finish. Two live scaffolds would each
 * have saved and restored the same process-level state (`DSH_HOME`, skill
 * roots), so overlapping them makes teardown restore a world the other one
 * already removed.
 */

import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode, type LaunchOptions, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const REMOTE_AUTHORITY = 'remote.localhost'
/** A value no redaction path may ever put on the wire or in the DOM. */
const CANARY = 'sk-canary-must-never-reach-a-browser'

/**
 * Seed a provider carrying a secret through the shipped settings provider's own
 * write path, so the value reaches the wire exactly as an operator's would.
 */
async function seedCanary(scaffold: WebScaffold): Promise<void> {
  await scaffold.ctx.settings.mutate(settingsNamespace('llm-pi-ai'), [{
    op: 'set',
    path: ['providers', 'canary-gateway'],
    value: {
      api: 'openai-completions',
      baseURL: 'https://canary.test',
      models: [{ id: 'canary-model' }],
      apiKeyEnv: 'CANARY_GATEWAY_KEY',
      headers: { Authorization: `Bearer ${CANARY}`, 'X-Org': 'canary-org' },
    },
  }])
}

/** One scaffold's whole life: launched, used, then closed before the next starts. */
async function withScaffold(
  options: LaunchOptions,
  use: (scaffold: WebScaffold) => Promise<void>,
): Promise<void> {
  const scaffold = await launchWebScaffold(options)
  try {
    await use(scaffold)
  } finally {
    await scaffold.close()
  }
}

/** POST one method from the page's own origin and report status with the business result. */
interface ProbeResult {
  readonly status: number
  readonly ok: boolean
  readonly body: string
}

/** The one describe field this scenario reads back off the handshake. */
function remoteConfigurationOf(probe: ProbeResult): unknown {
  const parsed = JSON.parse(probe.body) as { result: { value: { remoteConfiguration: unknown } } }
  return parsed.result.value.remoteConfiguration
}

async function call(page: Page, method: string, payload: unknown = {}): Promise<ProbeResult> {
  return await page.evaluate(async ({ name, args }) => {
    const response = await fetch(`/api/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `probe-${name}`, method: name, payload: args }),
    })
    const body = await response.text()
    let ok = false
    try {
      ok = (JSON.parse(body) as { result?: { ok?: boolean } }).result?.ok === true
    } catch {
      // A carrier-level refusal answers text, not an envelope; ok stays false.
    }
    return { status: response.status, ok, body }
  }, { name: method, args: payload })
}

describe.skipIf(MODE === 'record')('web e2e: configuration plane authority', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('refuses the configuration plane to a trusted remote authority by default', async () => {
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-config-plane-default'))
    await withScaffold({ remoteAuthority: REMOTE_AUTHORITY }, async (scaffold) => {
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      expect(new URL(page.url()).hostname).toBe(REMOTE_AUTHORITY)
      // The ordinary plane answers this authority, business result included,
      // which is what shows the refusals below are the privileged-set decision
      // and not the Host fence.
      const ordinary = await call(page, 'session.list')
      expect(ordinary.status).toBe(200)
      expect(ordinary.ok, ordinary.body.slice(0, 200)).toBe(true)
      for (const method of ['settings.describe', 'credentials.describe', 'llm.discoverModels']) {
        const refused = await call(page, method)
        expect(refused.status, method).toBe(403)
      }
      // The handshake tells the page the same thing the carrier enforces.
      const described = await call(page, 'host.describe')
      expect(described.ok).toBe(true)
      expect(remoteConfigurationOf(described)).toBe(false)
      expect(tripwire.pageErrors).toEqual([])
    })
    await page.close()
  }, 180_000)

  it('serves the real Settings UI to that authority once the deployment widens the plane, without leaking a secret', async () => {
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-config-plane-widened'))
    await withScaffold({
      remoteAuthority: REMOTE_AUTHORITY,
      privilegedAuthority: 'trusted-hosts',
    }, async (scaffold) => {
      await seedCanary(scaffold)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

      // Business success, not just a 200: a schema or domain failure also
      // answers 200 with ok:false.
      const settings = await call(page, 'settings.describe')
      expect(settings.status).toBe(200)
      expect(settings.ok, settings.body.slice(0, 300)).toBe(true)
      // credentials.describe takes refs; sending {} would fail the payload
      // schema and still answer 200.
      const credentials = await call(page, 'credentials.describe', { refs: [] })
      expect(credentials.ok, credentials.body.slice(0, 300)).toBe(true)
      const described = await call(page, 'host.describe')
      expect(remoteConfigurationOf(described)).toBe(true)

      // Positive control on public neighbours: the seeded provider really is in
      // this deployment and its non-secret fields do cross, so the canary
      // assertion below is not vacuous.
      expect(settings.body).toContain('canary-gateway')
      expect(settings.body).toContain('canary.test')
      // A credential REFERENCE name stays readable; only values are withheld.
      expect(settings.body).toContain('CANARY_GATEWAY_KEY')
      // The secret never crosses, from the apiKey slot or the header dict…
      expect(settings.body).not.toContain(CANARY)
      // …and the sidecar still names both positions, which is what proves the
      // values were redacted rather than never stored.
      const namespaces = (JSON.parse(settings.body) as {
        result: { value: { namespaces: { ns: string; secrets: { path: string[] }[] }[] } }
      }).result.value.namespaces
      const piAi = namespaces.find(entry => entry.ns === 'llm-pi-ai')
      const slots = (piAi?.secrets ?? []).map(secret => secret.path.join('.'))
      expect(slots).toContain('providers.canary-gateway.headers.Authorization')
      expect(slots).toContain('providers.canary-gateway.headers.X-Org')

      // The real Settings UI, not only the wire: the dialog opens, the Models
      // page renders its live provider join, and the seeded provider appears —
      // which only happens when the scope bound to Host persistence rather
      // than falling back to process memory.
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      await dialog.waitFor({ timeout: 15_000 })
      await dialog.getByRole('button', { name: 'Models' }).click()
      await dialog.getByText('canary-gateway', { exact: true }).first().waitFor({ timeout: 15_000 })
      // The key is configured, and the UI says so without ever holding it.
      const dom = await page.content()
      expect(dom).not.toContain(CANARY)
      expect(tripwire.pageErrors).toEqual([])
    })
    await page.close()
  }, 180_000)
})
