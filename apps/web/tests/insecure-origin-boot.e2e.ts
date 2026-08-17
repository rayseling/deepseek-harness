/**
 * Boot regression for insecure origins: the built Web composition must start
 * in a page whose `crypto` carries no `randomUUID`, which is the API surface
 * a browser presents on any plain-HTTP non-loopback origin (a LAN address, a
 * reverse-proxied host). A browser cannot be told to classify localhost as
 * insecure, so the test removes exactly the API that classification removes —
 * before any page script runs — and requires the boot handshake to complete
 * with zero page errors.
 */

import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('web e2e: boot without secure-context randomUUID', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

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
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('completes the boot handshake and renders the shell without page errors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-insecure-origin-boot'))
    // The environment premise holds inside the page…
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
    // …and boot still reached the session tree, which requires the readiness
    // handshake and the /api carrier — every request of which minted an rpcId.
    const tree = page.getByRole('tree', { name: 'Sessions' })
    await tree.waitFor({ timeout: 30_000 })
    expect(tripwire.pageErrors).toEqual([])
  })
})
