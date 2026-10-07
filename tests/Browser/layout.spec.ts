import { centre, dwell, expect, of, test } from './fixtures';

test('S16: a control is named by its text as written, with spaces between parts laid out on their own', async ({ page, open, flush, settle }) => {
    await open('/layout');

    for (const selector of ['#card', '#loud']) {
        const { x, y } = await centre(page, selector);
        await page.mouse.click(x, y);
        await page.waitForTimeout(150);
    }

    await flush();

    const clicks = of(await settle((all) => of(all, 'click').length >= 2), 'click');

    expect(clicks.map(({ target, section }) => [target, section])).toEqual([
        ['01 Black Mamba Gloss black', 'models'],
        ['Build yours', 'models'],
    ]);
});

test('S17: a header or footer inside an article belongs to the section around it, not the site', async ({ page, open, flush, settle }) => {
    await open('/layout');

    for (const selector of ['#share', '#reviews', '#save']) {
        const { x, y } = await centre(page, selector);
        await page.mouse.click(x, y);
        await page.waitForTimeout(150);
    }

    await flush();

    const clicks = of(await settle((all) => of(all, 'click').length >= 3), 'click');

    expect(clicks.map(({ target, section }) => [target, section])).toEqual([
        ['Share', 'models'],
        ['More reviews', 'models'],
        ['Save', null],
    ]);
});

test('S18: a fixed header and a sticky footer record clicks, but neither reach nor dwell', async ({ page, open, flush, settle }) => {
    await open('/layout');
    await page.waitForTimeout(1500);

    const place = async (selector: string, section: string) => {
        const box = (await page.locator(section).boundingBox())!;
        const { x, y } = await centre(page, selector);
        await page.mouse.click(x, y);
        await page.waitForTimeout(150);

        return { x: (x - box.x) / box.width, y: (y - box.y) / box.height };
    };

    const expected = [await place('#menu', 'body > header'), await place('#up', 'body > footer')];
    await flush();

    const events = await settle((all) => of(all, 'click').length >= 2 && dwell(all, 'models') > 0);
    const clicks = of(events, 'click');

    expect(clicks.map(({ target, section }) => [target, section])).toEqual([
        ['Menu', 'header'],
        ['Back to top', 'footer'],
    ]);

    clicks.forEach((click, index) => {
        expect(Math.abs(click.x! - expected[index].x)).toBeLessThanOrEqual(0.02);
        expect(Math.abs(click.y! - expected[index].y)).toBeLessThanOrEqual(0.02);
    });

    expect(of(events, 'section').map((event) => event.section)).toEqual(['models']);
    expect(dwell(events, 'header') + dwell(events, 'footer')).toBe(0);
    expect(dwell(events, 'models')).toBeGreaterThanOrEqual(1000);
});

test('S19: a modal dialog that opens on its own is reached and timed, though browsers fix it', async ({ page, open, flush, settle }) => {
    await open('/layout');
    await page.waitForTimeout(300);

    const position = await page.evaluate(() => {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('data-footprint-section', 'newsletter');
        dialog.textContent = 'Sign up';
        document.body.append(dialog);
        dialog.showModal();

        return getComputedStyle(dialog).position;
    });

    await page.waitForTimeout(1500);
    await flush();

    const events = await settle((all) => of(all, 'section').some((event) => event.section === 'newsletter') && dwell(all, 'newsletter') > 0);

    expect(position).toBe('fixed');
    expect(of(events, 'section').map((event) => event.section)).toEqual(['models', 'newsletter']);
    expect(dwell(events, 'newsletter')).toBeGreaterThanOrEqual(1000);
});
