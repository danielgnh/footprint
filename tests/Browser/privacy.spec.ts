import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function useTheSite(page: Page) {
    await page.click('#cta');
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        window.footprint?.track('tried');
        window.footprint?.flush?.();
    });
    await page.close({ runBeforeUnload: true });
}

test.describe('S11: bail-outs', () => {
    test.describe('under automation', () => {
        test.use({ automation: true });

        test('records nothing', async ({ page, open, received }) => {
            await open('/long');
            await useTheSite(page);
            await new Promise((resolve) => setTimeout(resolve, 500));

            expect(await received()).toEqual([]);
        });
    });

    test('Global Privacy Control records nothing', async ({ page, open, received }) => {
        await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
        await open('/long');
        await useTheSite(page);
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(await received()).toEqual([]);
    });

    test('Do Not Track records nothing', async ({ page, open, received }) => {
        await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }));
        await open('/long');
        await useTheSite(page);
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(await received()).toEqual([]);
    });

    test('a zero sample records nothing', async ({ page, open, received }) => {
        await open('/long', { sample: '0' });
        await useTheSite(page);
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(await received()).toEqual([]);
    });

    test('a site that does not honour Global Privacy Control still records', async ({ page, open, received }) => {
        await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
        await open('/long', { gpc: 'false' });
        await useTheSite(page);

        await expect.poll(async () => (await received()).length).toBeGreaterThan(0);
    });
});
