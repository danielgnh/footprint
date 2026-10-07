import { centre, expect, of, test } from './fixtures';

test.describe('S12: touch', () => {
    test.skip(({ isMobile }) => !isMobile, 'Touch devices only');

    test('taps are clicks, a double tap is not rage, a triple tap is', async ({ page, open, flush, received, settle }) => {
        await open('/clicks');

        const text = await centre(page, '#text');
        const pay = await centre(page, '#pay');

        await page.touchscreen.tap(text.x, text.y);
        await page.waitForTimeout(800);
        await page.touchscreen.tap(pay.x, pay.y);
        await page.touchscreen.tap(pay.x, pay.y);
        await page.waitForTimeout(800);

        await flush();
        let events = await settle((all) => of(all, 'click').length >= 3);
        expect(of(events, 'rage')).toEqual([]);

        for (let i = 0; i < 3; i++) {
            await page.touchscreen.tap(pay.x, pay.y);
        }

        await page.waitForTimeout(200);
        await flush();
        events = await settle((all) => of(all, 'rage').length > 0);

        const first = of(events, 'click')[0];
        expect([first.target, first.section]).toEqual(['Build yours', 'hero']);
        expect(first.x).not.toBeNull();
        expect(of(events, 'rage').map((event) => event.target)).toEqual(['Pay']);

        const visit = (await received())[0].batch.visit;
        expect(visit.device).toBe('mobile');
        expect(visit.vw).toBe(Math.floor(page.viewportSize()!.width / 50) * 50);
    });
});
