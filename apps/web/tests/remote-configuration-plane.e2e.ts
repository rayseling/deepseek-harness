/**
 * The configuration plane's authority, proven through the assembled Web
 * composition rather than a hand-built context: one remote authority reaching
 * the same built server twice, once under the default posture and once with
 * the deployment opt-in, so the difference is the composed `connection` row's
 * `privilegedAuthority` and nothing else.
 *
 * The browser resolves `*.localhost` to loopback while sending that name as
 * `Host`, which is what makes a real non-loopback authority testable against a
 * server bound to 127.0.0.1.
 */

import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const REMOTE_AUTHORITY = 'remote.localhost'

/** Ask the page's own origin for a method, returning the carrier's status. */
async function statusOf(page: Page, method: string): Promise<number> {
  return await page.evaluate(async (name) => {
    const response = await fetch(`/api/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `probe-${name}`, method: name, payload: {} }),
    })
    return response.status
  }, method)
}

describe.skipIf(MODE === 'record')('web e2e: configuration plane authority', () => {
  let scaffold: WebScaffold
  let widened: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ remoteAuthority: REMOTE_AUTHORITY })
    widened = await launchWebScaffold({
      remoteAuthority: REMOTE_AUTHORITY,
      privilegedAuthority: 'trusted-hosts',
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
  }, 240_000)

  afterAll(async () => {
    const failures: unknown[] = []
    for (const close of [() => browser?.close(), () => scaffold?.close(), () => widened?.close()]) {
      try {
        await close()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'web e2e teardown failed')
  })

  it('refuses the configuration plane to a trusted remote authority by default', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-config-plane-default'))
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    expect(new URL(page.url()).hostname).toBe(REMOTE_AUTHORITY)
    // The ordinary plane answers this authority, which is what shows the
    // refusals below are the privileged-set decision and not the fence.
    expect(await statusOf(page, 'session.list')).toBe(200)
    for (const method of ['settings.describe', 'credentials.describe', 'llm.discoverModels']) {
      expect(await statusOf(page, method), method).toBe(403)
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('answers the same authority once the deployment widens the plane', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-config-plane-widened'))
    await page.goto(widened.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    for (const method of ['settings.describe', 'credentials.describe']) {
      expect(await statusOf(page, method), method).toBe(200)
    }
    // A described value never carries a secret, whichever authority asked.
    const described = await page.evaluate(async () => {
      const response = await fetch('/api/settings.describe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'describe-secrets',
          method: 'settings.describe',
          payload: {},
        }),
      })
      return await response.text()
    })
    expect(described).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/)
    expect(described).not.toMatch(/(?:^|[^A-Za-z])Bearer\s+\S{12,}/)
    expect(tripwire.pageErrors).toEqual([])
  })
})
