import { expect, of, test } from './fixtures';

test('S3: SPA navigation opens a view per path change, not per query change', async ({ page, open, flush, settle }) => {
    await open('/spa');
    await page.waitForTimeout(300);

    await page.click('#to-b');
    await page.waitForTimeout(300);
    await page.click('#back');
    await page.waitForURL((url) => url.pathname === '/spa');
    await page.waitForTimeout(300);
    await page.click('#query');
    await page.waitForTimeout(300);
    await flush();

    const events = await settle((all) => of(all, 'view').length >= 3);
    await page.waitForTimeout(300);

    expect(of(events, 'view').map(({ view, path, from }) => [view, path, from])).toEqual([
        [1, '/spa', null],
        [2, '/spa/b', '/spa'],
        [3, '/spa', '/spa/b'],
    ]);

    const reached = (view: number) => of(events, 'section').filter((event) => event.view === view).map((event) => event.section);

    expect(reached(1)).toEqual(expect.arrayContaining(['top', 'page-a']));
    expect(reached(2)).toEqual(expect.arrayContaining(['top', 'page-b']));
    expect(reached(2)).not.toContain('page-a');
    expect(reached(3)).toEqual(expect.arrayContaining(['top', 'page-a']));
    expect(reached(3)).not.toContain('page-b');
    expect(new Set((await settle(() => true)).map((event) => event.view))).toEqual(new Set([1, 2, 3]));
});

test('S3: a full page load takes its previous path from the same-origin referrer', async ({ page, open, received, settle }) => {
    await open('/long');
    await page.click('header a');
    await page.waitForURL((url) => url.pathname === '/spa');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.footprint?.flush?.());

    await settle((all) => of(all, 'view').length >= 2);
    const visits = new Map<string, string | null>();

    for (const { batch } of await received()) {
        for (const event of of(batch.events, 'view')) {
            visits.set(`${batch.visit.id}:${event.view}`, event.from);
        }
    }

    expect([...visits.values()]).toEqual([null, '/long']);
    expect(new Set((await received()).map(({ batch }) => batch.visit.id)).size).toBe(2);
});
