import { dwell, expect, of, scrollToBottom, scrollToSection, test } from './fixtures';

test('S1: a long page reports reach in order, dwell to within 10% and full depth', async ({ page, open, flush, settle }) => {
    await open('/long');
    await page.waitForTimeout(300);

    for (const name of ['s1', 's2']) {
        await scrollToSection(page, name);
        await page.waitForTimeout(300);
    }

    await scrollToSection(page, 's3');
    await page.waitForTimeout(2000);

    for (const name of ['s4', 's5', 's6']) {
        await scrollToSection(page, name);
        await page.waitForTimeout(300);
    }

    await scrollToBottom(page);
    await page.waitForTimeout(500);
    await flush();

    const events = await settle((all) => of(all, 'scroll').some((event) => event.value === 100) && dwell(all, 's3') > 0);
    const reached = of(events, 'section').filter((event) => /^s\d$/.test(event.section));

    expect(reached.map((event) => event.section)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(reached.map((event) => event.i)).toEqual([...reached.map((event) => event.i)].sort((a, b) => a - b));
    expect(of(events, 'section').map((event) => event.section)).toContain('footer');
    expect(dwell(events, 's3')).toBeGreaterThanOrEqual(1800);
    expect(dwell(events, 's3')).toBeLessThanOrEqual(2200);
    expect(Math.max(...of(events, 'scroll').map((event) => event.value))).toBe(100);
    expect(dwell(events, null)).toBeGreaterThan(3500);
});

test('S2: a section taller than the viewport counts once it fills half of it', async ({ page, open, flush, settle }) => {
    await open('/tall');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(1000);
    await flush();

    const events = await settle((all) => of(all, 'section').some((event) => event.section === 'story'));
    const reached = of(events, 'section').map((event) => event.section);

    expect(reached).toContain('intro');
    expect(reached).toContain('story');
    expect(reached).not.toContain('outro');
    expect(dwell(events, 'story')).toBeGreaterThanOrEqual(800);
});

test.describe('S13: Lenis', () => {
    test.skip(({ isMobile }) => isMobile, 'Lenis leaves touch to the platform');

    test('a smooth-scrolled page reports the same as a native one', async ({ page, open, flush, settle }) => {
        await open('/lenis');
        await page.waitForTimeout(300);

        const glide = async (name: string) =>
            page.evaluate(
                (section) =>
                    new Promise<void>((resolve) => {
                        const element = document.querySelector(`[data-footprint-section="${section}"]`)!;
                        (window as unknown as { lenis: { scrollTo(target: Element, options: object): void } }).lenis.scrollTo(element, { duration: 0.6, onComplete: () => resolve() });
                    }),
                name,
            );

        await glide('s2');
        await page.waitForTimeout(1500);
        await glide('s3');
        await page.mouse.move(300, 300);

        for (let i = 0; i < 12; i++) {
            await page.mouse.wheel(0, 400);
            await page.waitForTimeout(60);
        }

        await page.waitForTimeout(1500);
        await flush();

        const events = await settle((all) => of(all, 'scroll').some((event) => event.value === 100));

        expect(of(events, 'section').filter((event) => /^s\d$/.test(event.section)).map((event) => event.section)).toEqual(['s1', 's2', 's3', 's4']);
        expect(dwell(events, 's2')).toBeGreaterThanOrEqual(1500);
        expect(dwell(events, 's2')).toBeLessThanOrEqual(2600);
        expect(Math.max(...of(events, 'scroll').map((event) => event.value))).toBe(100);
    });
});
