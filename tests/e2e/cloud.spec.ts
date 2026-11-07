import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { handle, type Env } from '../../server/src/worker.ts';
import { MemoryBucket } from '../memorybucket.ts';
import { continueAs, createCharacter, expect, saveAndQuit, test, waitAtCommand, waitForEngine } from './helpers.ts';

const CLOUD = 'https://cloud.test';

/** The sync service, run here over a bucket in memory, answering the pages' requests to it. */
async function serveCloud(context: BrowserContext, env: Env): Promise<void> {
  await context.route(`${CLOUD}/**`, async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    const response = await handle(new Request(request.url(), { method: request.method(), headers: await request.allHeaders(), body: body && request.method() !== 'GET' ? new Uint8Array(body) : undefined }), env);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await context.addInitScript((url) => localStorage.setItem('tome2mobile.cloudUrl', url), CLOUD);
}

/** A passkey authenticator built into the device, as Face ID is. */
async function authenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, id: authenticatorId };
}

async function openCloud(page: Page): Promise<void> {
  await page.locator('#title-screen [data-link="backup"]', { hasText: 'Cloud & backup' }).click();
}

function bucketManifest(env: Env): { files: Record<string, unknown>; heroes: Record<string, { playing: boolean }> } | null {
  const bucket = env.SAVES as MemoryBucket;
  const key = [...bucket.objects.keys()].find((k) => k.endsWith('/manifest.json'));
  return key ? JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.data)) : null;
}

test('cloud sync carries a hero to another device, which can take them up while the first plays', async ({ page, browser, settings }) => {
  const env: Env = { SAVES: new MemoryBucket(), SESSION_SECRET: 'e2e', ALLOWED_ORIGINS: 'http://localhost:4173' };
  await serveCloud(page.context(), env);
  await page.goto('./?wizard');
  const first = await authenticator(page);
  await waitForEngine(page);

  /* The first device turns sync on with a new passkey, plays a hero and sets them down. */
  await openCloud(page);
  await page.locator('.sheet .row-button', { hasText: 'Turn on cloud sync' }).click();
  await expect(page.locator('.sheet-title', { hasText: 'Keep your heroes in sync' })).toBeVisible();
  await page.locator('.sheet-action[data-action="turn-on"]').click();
  await expect(page.locator('#toast')).toContainText('Cloud sync is on');
  await createCharacter(page, 'Elder');
  await saveAndQuit(page);
  await expect.poll(() => bucketManifest(env)?.heroes.Elder?.playing, { timeout: 30_000 }).toBe(false);
  expect(Object.keys(bucketManifest(env)!.files).some((p) => p.endsWith('save/Elder'))).toBe(true);

  /* The second device signs in with the same passkey (as iCloud Keychain would carry it) and finds the hero. */
  const { credentials } = await first.cdp.send('WebAuthn.getCredentials', { authenticatorId: first.id });
  const other = await browser.newContext({ ...test.info().project.use });
  await other.addInitScript((stored) => localStorage.setItem('tome2mobile.settings', JSON.stringify(stored)), settings);
  await serveCloud(other, env);
  const second = await other.newPage();
  await second.goto('./?wizard');
  const keychain = await authenticator(second);
  for (const credential of credentials) await keychain.cdp.send('WebAuthn.addCredential', { authenticatorId: keychain.id, credential });
  await waitForEngine(second);
  await expect(second.locator('#title-screen .title-choice', { hasText: 'Continue as' })).toHaveCount(0);
  await openCloud(second);
  await second.locator('.sheet .row-button', { hasText: 'Turn on cloud sync' }).click();
  await second.locator('.sheet-action[data-action="sign-in"]').click();
  await expect(second.locator('#title-screen .title-choice', { hasText: 'Continue as Elder' })).toBeVisible({ timeout: 60_000 });
  await continueAs(second, 'Elder');

  /* The first device takes the hero back while the second plays, after saying so. */
  await expect(page.locator('#title-screen .title-choice', { hasText: 'Continue as Elder' })).toBeVisible();
  await page.locator('#title-screen .title-choice', { hasText: 'Continue as Elder' }).click();
  await expect(page.locator('.sheet-title', { hasText: 'Elder is in play on your' })).toBeVisible({ timeout: 30_000 });
  await page.locator('.sheet-action[data-action="continue-here"]').click();
  await expect(page.locator('#title-screen')).toBeHidden({ timeout: 30_000 });
  await waitAtCommand(page);

  /* The second device learns at its next save, and goes back to the title. */
  await second.locator('#toolbar [data-action="menu"]').click();
  await second.locator('.sheet .row-button', { hasText: 'Save game' }).click();
  await expect(second.locator('.sheet-title', { hasText: 'Elder continued on your' })).toBeVisible({ timeout: 30_000 });
  await second.locator('.sheet-action[data-action="to-title"]').click();
  await expect(second.locator('#title-screen .title-choice', { hasText: 'Continue as Elder' })).toBeVisible({ timeout: 60_000 });
  await other.close();
});
