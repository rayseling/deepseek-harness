// Trusted non-loopback Web access persists settings to the Host document, so
// acknowledging the notice there keeps it dismissed after reload.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_COPY, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION,
  type WebScaffold,
} from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  const acknowledged = { [WELCOME_NOTICE_ACK_FIELD]: WELCOME_NOTICE_VERSION }
  const hostWelcomeSection = () => scaffold.ctx.settings.describe()
    .find(row => row.ns === WELCOME_NOTICE_SETTINGS_NAMESPACE)?.value ?? {}

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: 'remote.localhost',
      welcomeNoticePending: true,
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('persists the acknowledgement to the Host and omits the notice after reload', async () => {
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)
    expect(hostWelcomeSection()).not.toMatchObject(acknowledged)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(() => hostWelcomeSection(), { timeout: 15_000 }).toMatchObject(acknowledged)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    // The Coding Tools switch turns on only after this page receives the Host settings answer,
    // which carries the acknowledgement in the same read.
    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '设置' })
    await expect.poll(
      () => settings.getByRole('switch', { name: '代码工作工具' }).getAttribute('aria-checked'),
      { timeout: 15_000 },
    ).toBe('true')
    expect(await welcome.count()).toBe(0)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
