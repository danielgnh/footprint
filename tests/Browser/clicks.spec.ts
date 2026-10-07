import { centre, expect, of, test } from './fixtures';

test('S4: clicks are named, linked and placed inside their section', async ({ page, open, flush, settle }) => {
    await open('/clicks');

    for (const selector of ['#text', '#icon', '#nested b', '#named', '#internal', '#external', '#mail', '#size']) {
        const { x, y } = await centre(page, selector);
        await page.mouse.click(x, y);
        await page.waitForTimeout(150);
    }

    const hero = (await page.locator('#hero').boundingBox())!;
    const target = await centre(page, '#named');
    await flush();

    const clicks = of(await settle((all) => of(all, 'click').length >= 8), 'click');

    expect(clicks.map(({ target, href, section }) => [target, href, section])).toEqual([
        ['Build yours', null, 'hero'],
        ['Open geometry', null, 'hero'],
        ['Compare sizes', null, 'hero'],
        ['Spec sheet toggle', null, 'hero'],
        ['The bike', '/bikes/gravel', 'hero'],
        ['Instagram', 'www.instagram.com', 'hero'],
        ['{email}', 'mailto:', 'hero'],
        ['M (170–180 cm)', null, 'hero'],
    ]);

    const named = clicks[3];
    expect(named.x).toBeCloseTo((target.x - hero.x) / hero.width, 1);
    expect(Math.abs(named.x! - (target.x - hero.x) / hero.width)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(named.y! - (target.y - hero.y) / hero.height)).toBeLessThanOrEqual(0.02);
});

test('S5: four rapid clicks on one spot are one rage click', async ({ page, open, flush, settle }) => {
    await open('/clicks');
    const { x, y } = await centre(page, '#pay');

    for (let i = 0; i < 4; i++) {
        await page.mouse.click(x, y);
    }

    await page.waitForTimeout(200);
    await flush();

    const events = await settle((all) => of(all, 'rage').length > 0 && of(all, 'click').length >= 4);

    expect(of(events, 'rage').map(({ target, section }) => [target, section])).toEqual([['Pay', 'hero']]);
    expect(of(events, 'click').filter((event) => event.target === 'Pay')).toHaveLength(4);
});

test('S6: a click nothing answers is dead, one the page answers is not', async ({ page, open, flush, settle }) => {
    await open('/clicks');

    for (const selector of ['#image', '#plain', '#reacts']) {
        const { x, y } = await centre(page, selector);
        await page.mouse.click(x, y);
        await page.waitForTimeout(1300);
    }

    await flush();
    const events = await settle((all) => of(all, 'dead').length >= 2);
    await page.waitForTimeout(200);

    expect(of(events, 'dead').map(({ target, section }) => [target, section])).toEqual([
        ['Black Mamba side view', 'hero'],
        ['p', 'hero'],
    ]);
    await expect(page.locator('#opened')).toHaveText('opened');
});

test('S8: ignored subtrees record nothing and visible text is scrubbed', async ({ page, open, flush, received, settle }) => {
    await open('/clicks');
    const account = await centre(page, '#account');

    for (let i = 0; i < 3; i++) {
        await page.mouse.click(account.x, account.y);
    }

    await page.click('#contact');
    await page.waitForTimeout(200);
    await flush();

    const events = await settle((all) => of(all, 'click').length >= 1);
    const bodies = (await received()).map((item) => item.body).join('\n');

    expect(of(events, 'click').map(({ target, section }) => [target, section])).toEqual([['Write {email} or call {n}', 'scrubbed']]);
    expect(of(events, 'rage')).toEqual([]);
    expect(bodies).not.toContain('jane@example.com');
    expect(bodies).not.toContain('912345678');
    expect(bodies).not.toContain('Jane Doe');
});
