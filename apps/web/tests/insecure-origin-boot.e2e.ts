/**
 * Boot regression for insecure origins: the built Web composition must start
 * in a page whose `crypto` carries no `randomUUID`, which is the API surface
 * a browser presents on any plain-HTTP non-loopback origin (a LAN address, a
 * reverse-proxied host). A browser cannot be told to classify localhost as
 * insecure, so the test removes exactly the API that classification removes —
 * before any page script runs.
 *
 * What makes this a real tripwire: a failed mint inside the readiness
 * handshake is swallowed by `ConnectionController`, which aborts the
 * generation and retries with a `connection lost` warning, so a rendered
 * sidebar proves nothing on its own. The scenario therefore pins the
 * handshake itself — the `host.describe` POST must answer 200 with an `ok`
 * body — and requires the console tripwire (whose warning filter matches that
 * retry message) to stay silent.
 */

import type { Browser, Page, Response } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('web e2e: boot without secure-context randomUUID', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let handshake: Promise<Response>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.addInitScript(() => {
      // Secure contexts define randomUUID on Crypto.prototype; insecure
      // origins never have it. Deleting the prototype member reproduces the
      // insecure surface for every crypto reference the app takes.
      delete (Crypto.prototype as unknown as Record<string, unknown>)['randomUUID']
    })
    // Armed before navigation: the handshake is the first thing boot does.
    handshake = page.waitForResponse(response => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/host.describe'
    ), { timeout: 30_000 })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    // Both cleanups run even if the first rejects: skipping scaffold.close()
    // would leak its Host fiber, bound port and temp roots for the rest of the
    // file's lifetime. Same shape the scaffold's own teardown uses.
    const failures: unknown[] = []
    try {
      await browser?.close()
    } catch (error) {
      failures.push(error)
    }
    try {
      await scaffold?.close()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'web e2e teardown failed')
  })

  it('completes the readiness handshake and stays connected', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-insecure-origin-boot'))
    // The environment premise holds inside the page.
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')

    // The handshake round trip happened, which is only possible if the client
    // minted an rpcId for it: a throw would have aborted the generation before
    // any request left the page.
    const response = await handshake
    expect(response.ok(), 'host.describe HTTP response').toBe(true)
    const body = await response.json() as { result?: { ok?: unknown } }
    expect(body.result?.ok, 'host.describe result').toBe(true)

    // And the connection stayed up: the tripwire's filter matches the
    // controller's `connection lost, retry #N`, which a mint failure produces.
    const tree = page.getByRole('tree', { name: 'Sessions' })
    await tree.waitFor({ timeout: 30_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
