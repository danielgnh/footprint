import { dwell, expect, hide, scrollToSection, test } from './fixtures';

test.describe('S9: flushing', () => {
    test('when the page is hidden', async ({ page, open, received }) => {
        await open('/long');
        await page.waitForTimeout(500);
        await hide(page);

        await expect.poll(async () => (await received()).length).toBe(1);
    });

    test('when the page navigates away', async ({ page, open, settle }) => {
        await open('/long');
        await scrollToSection(page, 's2');
        await page.waitForTimeout(800);
        await page.goto('/tall');

        const events = await settle((all) => dwell(all, 's2') > 0);

        expect(dwell(events, 's2')).toBeGreaterThanOrEqual(600);
    });

    test('when the page closes', async ({ page, open, settle, browserName }) => {
        test.skip(browserName === 'webkit', "Playwright's WebKit drops every beacon from a closing page, a raw one included; navigating away covers it");

        await open('/long');
        await scrollToSection(page, 's2');
        await page.waitForTimeout(800);
        await page.close({ runBeforeUnload: true });

        const events = await settle((all) => dwell(all, 's2') > 0);

        expect(dwell(events, 's2')).toBeGreaterThanOrEqual(600);
    });

    test('every 15 seconds', async ({ page, open, received }) => {
        await page.clock.install();
        await open('/long');

        await page.clock.runFor(14_000);
        await page.waitForTimeout(300);
        expect(await received()).toHaveLength(0);

        await page.clock.runFor(1_000);
        await expect.poll(async () => (await received()).length).toBe(1);
    });

    test('once 50 events are buffered', async ({ page, open, received }) => {
        await open('/long');
        await page.evaluate(() => {
            for (let i = 0; i < 60; i++) {
                window.footprint!.track('tick', { i });
            }
        });

        await expect.poll(async () => (await received()).length).toBeGreaterThanOrEqual(1);
        expect((await received())[0].batch.events.length).toBeGreaterThanOrEqual(50);
    });

    test('a crashed tab loses at most one interval of dwell', async ({ page, open, settle, browserName, isMobile }) => {
        test.skip(browserName !== 'chromium' || isMobile, 'Only Chromium can crash a renderer on demand');

        await page.clock.install();
        await open('/long');
        await scrollToSection(page, 's3');
        await page.clock.runFor(500);

        for (let i = 0; i < 4; i++) {
            await page.mouse.move(100 + i, 100);
            await page.clock.runFor(10_000);
        }

        await page.goto('chrome://crash').catch(() => undefined);

        const events = await settle((all) => dwell(all, 's3') >= 25_000);

        expect(dwell(events, 's3')).toBeGreaterThanOrEqual(40_000 - 15_000);
    });
});

test.describe('S10: failures', () => {
    test('a failing endpoint gets one batch per trigger, no retry storm', async ({ page, open, received }) => {
        await page.clock.install();
        await open('/long', { fail: '500' });

        for (let i = 0; i < 6; i++) {
            await page.mouse.move(100 + i, 100);
            await page.clock.runFor(10_000);
        }

        await page.waitForTimeout(500);
        const count = (await received()).length;

        expect(count).toBeGreaterThanOrEqual(3);
        expect(count).toBeLessThanOrEqual(5);
    });

    test('a refused beacon falls back to fetch without cookies', async ({ page, open, received, context, baseURL }) => {
        await context.addCookies([{ name: 'session', value: 'secret', url: baseURL! }]);
        await page.addInitScript(() => {
            Navigator.prototype.sendBeacon = () => false;
        });
        await open('/long');
        await page.waitForTimeout(300);
        await page.evaluate(() => window.footprint?.flush?.());

        await expect.poll(async () => (await received()).length).toBe(1);
        expect((await received())[0].headers.cookie).toBeNull();
        expect((await received())[0].headers['sec-fetch-mode']).toBe('cors');
    });

    test('a beacon is plain text and carries the page cookies, which the server never reads', async ({ page, open, received, context, baseURL }) => {
        await context.addCookies([{ name: 'session', value: 'secret', url: baseURL! }]);
        await open('/long');
        await page.evaluate(() => window.footprint?.flush?.());

        await expect.poll(async () => (await received()).length).toBe(1);
        expect((await received())[0].headers['content-type']?.toLowerCase()).toBe('text/plain;charset=utf-8');
        expect((await received())[0].headers.cookie).toContain('session=secret');
    });

    test('nothing that can send still breaks nothing', async ({ page, open, received }) => {
        await page.addInitScript(() => {
            Navigator.prototype.sendBeacon = () => {
                throw new TypeError('quota');
            };
            window.fetch = () => {
                throw new TypeError('offline');
            };
        });
        await open('/robust');
        await page.click('#count');
        await page.evaluate(() => window.footprint?.flush?.());
        await hide(page);

        await expect(page.locator('#clicks')).toHaveText('1');
        await page.waitForTimeout(300);
        expect(await received()).toHaveLength(0);
    });
});
