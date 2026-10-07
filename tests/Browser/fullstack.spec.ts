import { expect, test } from '@playwright/test';

// The real thing: a Laravel app serving @footprint, the real endpoint, a
// SQLite database. What a browser does on the page has to land in the rows.

interface Rows {
    visits: Array<Record<string, string | number | null>>;
    footprints: Array<Record<string, string | number | null>>;
}

const CANARY = 'canary-7f3a@example.com';

test('what a visitor does lands in the database, and nothing more', async ({ page, request }) => {
    const campaign = `smoke-${Date.now().toString(36)}`;

    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }));
    await page.goto(`/smoke?utm_source=playwright&utm_campaign=${campaign}`);
    await page.waitForTimeout(300);

    const scrollTo = (name: string) =>
        page.evaluate((section) => {
            const element = document.querySelector(`[data-footprint-section="${section}"]`)!;
            window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY);
        }, name);

    await page.click('#cta');
    await page.click('#link');
    await scrollTo('s2');
    await page.fill('[name=email]', CANARY);
    await page.waitForTimeout(1500);
    await scrollTo('s3');
    await page.waitForTimeout(300);
    await scrollTo('s4');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    await page.goto('/smoke');

    let rows: Rows = { visits: [], footprints: [] };
    let visit: Rows['visits'][number] | undefined;
    let mine: Rows['footprints'] = [];

    await expect
        .poll(async () => {
            rows = await (await request.get('/_footprint/rows')).json();
            visit = rows.visits.find((candidate) => candidate.utm_campaign === campaign);
            mine = rows.footprints.filter((row) => row.visit_id === visit?.id);

            return mine.some((row) => row.type === 'abandon');
        })
        .toBe(true);

    const of = (type: string) => mine.filter((row) => row.type === type);
    const dwell = (section: string | null) => of('dwell').filter((row) => row.section === section).reduce((sum, row) => sum + Number(row.value), 0);

    expect(visit).toMatchObject({ entry_path: '/smoke', device: 'desktop', viewport: 1250, lang: 'en', utm_source: 'playwright', referrer_host: null });
    expect(of('view').map((row) => [row.path, row.previous])).toEqual([['/smoke', null]]);
    expect(of('section').map((row) => row.section)).toEqual(['s1', 's2', 's3', 's4']);
    expect(dwell('s2')).toBeGreaterThanOrEqual(1500);
    expect(dwell('s2')).toBeLessThanOrEqual(2200);
    expect(Math.max(...of('scroll').map((row) => Number(row.value)))).toBe(100);
    expect(of('click').map((row) => [row.target, row.href, row.section])).toEqual([
        ['Build yours', null, 's1'],
        ['Your order', '/orders/{token}', 's1'],
    ]);
    expect(of('field').map((row) => [row.target, row.form])).toEqual([['email', 'quote']]);
    expect(of('abandon').map((row) => [row.target, row.form])).toEqual([['email', 'quote']]);
    expect(Number(visit!.events)).toBe(mine.length);

    const stored = JSON.stringify(rows);

    expect(stored).not.toContain('canary');
    expect(stored).not.toContain('127.0.0.1');
    expect(stored).not.toContain('Mozilla');
    expect(stored).not.toContain('Xk9fQ2LmP0aZ7bR4tY1uW8eV3sD6gH5jN2kL9mQ0');
});

test('a bot is answered and not stored', async ({ request }) => {
    const id = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
    const response = await request.post('/footprint/events', {
        headers: { Origin: 'http://localhost:4318', 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Content-Type': 'text/plain' },
        data: JSON.stringify({ v: 1, visit: { id, ref: null, utm: {}, device: 'desktop', vw: 1200, lang: 'en' }, events: [{ type: 'view', t: 0, view: 1, path: '/', from: null }] }),
    });

    expect(response.status()).toBe(204);

    const rows: Rows = await (await request.get('/_footprint/rows')).json();
    expect(rows.visits.find((visit) => visit.id === id)).toBeUndefined();
});
