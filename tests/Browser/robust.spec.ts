import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, of, scrollToBottom, scrollToSection, test } from './fixtures';

test('S14: an error inside the tracker never reaches the page', async ({ page, open, flush, settle }) => {
    await open('/robust');
    await page.evaluate(() => {
        Element.prototype.closest = () => {
            throw new Error('boom');
        };
    });

    await page.click('#count');
    await page.click('#words');
    await page.focus('[name=q]');
    await page.evaluate(() => window.scrollTo(0, 50));

    await expect(page.locator('#clicks')).toHaveText('1');
    await flush();
    expect(of(await settle((all) => of(all, 'view').length > 0), 'view')).toHaveLength(1);
});

test('S14: a browser without IntersectionObserver still records views and clicks', async ({ page, open, flush, settle }) => {
    await page.addInitScript(() => {
        delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
    });
    await open('/robust');
    await page.click('#count');
    await flush();

    const events = await settle((all) => of(all, 'click').length > 0);

    expect(of(events, 'view')).toHaveLength(1);
    expect(of(events, 'click').map((event) => event.target)).toEqual(['Count']);
    expect(of(events, 'section')).toEqual([]);
});

test('S15: the tracker stays within 6 kB gzipped', async () => {
    const size = gzipSync(readFileSync(new URL('../../resources/dist/footprint.js', import.meta.url)), { level: 9 }).length;

    expect(size).toBeLessThanOrEqual(6 * 1024);
});

test('S15: scrolling a long page causes no long task', async ({ page, open, browserName }) => {
    test.skip(browserName !== 'chromium', 'Long task timing is Chromium only');

    await page.addInitScript(() => {
        (window as unknown as { longTasks: number[] }).longTasks = [];
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                (window as unknown as { longTasks: number[] }).longTasks.push(entry.duration);
            }
        }).observe({ type: 'longtask', buffered: false });
    });
    await open('/long');
    await page.waitForTimeout(300);
    await page.evaluate(() => ((window as unknown as { longTasks: number[] }).longTasks = []));

    for (const name of ['s1', 's2', 's3', 's4', 's5', 's6']) {
        await scrollToSection(page, name);
        await page.waitForTimeout(100);
    }

    await scrollToBottom(page);
    await page.mouse.click(50, 50);
    await page.evaluate(() => window.footprint?.flush?.());
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)).toEqual([]);
});
