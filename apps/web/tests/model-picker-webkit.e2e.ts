// Web e2e scenario: in WebKit, a pointer click on a row of the composer's
// model picker selects that model. WebKit gives a pressed `<button>` no focus,
// so a press that moved focus off the row the drilled pane had focused would
// close the card on that blur during mousedown, and the row would never receive
// its click. Chromium focuses pressed buttons and cannot show this, so the
// scenario runs in WebKit and skips where no Playwright WebKit build is
// installed (`pnpm exec playwright install webkit`).
// Zero model calls: declaring and selecting a model is settings/session
// traffic only, so there is no fixture and a stray stream would fail loud.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** Starts the Agent default on this scenario's declared route. */
const OVERLAY = fileURLToPath(new URL('./model-picker-webkit.overlay.yml', import.meta.url))
const WEBKIT_INSTALLED = existsSync(webkit.executablePath())

describe.skipIf(webSnapshotMode() === 'record' || !WEBKIT_INSTALLED)('web e2e: WebKit selects a model with the pointer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [
            { id: 'acme-think', name: 'Acme Think' },
            { id: 'acme-swift', name: 'Acme Swift' },
          ],
        },
      },
    })
    browser = await webkit.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('selects the clicked row', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-picker-webkit'))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 }).toMatch(/Acme Think/)

    // Drilling into the model pane focuses the row in use; the click lands on
    // the other row, so the press itself must not move focus.
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'Acme Swift' }).click()
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 }).toMatch(/Acme Swift/)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
