import { expect, of, test } from './fixtures';

const CANARY = 'canary-7f3a@example.com';

test('S7: fields touched and the field given up on are recorded, never what was typed', async ({ page, open, received, settle }) => {
    await open('/forms');

    await page.fill('[name=email]', CANARY);
    await page.fill('[name=name]', CANARY);
    await page.fill('[name=notes]', `${CANARY} call me on 912 345 678`);
    await page.fill('[name=password]', 'hunter2-canary');
    await page.fill('#newsletter input', CANARY);
    await page.press('#newsletter input', 'Enter');
    await page.waitForTimeout(100);
    await page.click('#away');
    await page.waitForURL((url) => url.pathname === '/long');

    const events = await settle((all) => of(all, 'abandon').length > 0);
    const first = events.filter((event) => event.path === '/forms');

    expect(of(first, 'field').map(({ target, form }) => [target, form])).toEqual([
        ['email', 'quote'],
        ['name', 'quote'],
        ['notes', 'quote'],
        ['password', 'quote'],
        ['Newsletter email', 'Newsletter'],
    ]);
    expect(of(first, 'submit').map((event) => event.form)).toEqual(['Newsletter']);
    expect(of(first, 'abandon').map(({ target, form }) => [target, form])).toEqual([['password', 'quote']]);

    const bodies = (await received()).map((item) => item.body).join('\n');

    expect(bodies).not.toContain('canary');
    expect(bodies).not.toContain('hunter2');
    expect(bodies).not.toContain('912');
});
