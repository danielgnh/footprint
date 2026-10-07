import { describe, expect, it } from 'vitest';
import { $, boot, html, transition } from './support';

const CANARY = 'canary-7f3a@example.com';

const focus = (selector: string): void => {
    $(selector).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
};

const type = (selector: string, value: string): void => {
    const input = $(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const QUOTE = `
    <form name="quote">
        <input name="email" type="email">
        <input name="name">
        <input type="hidden" name="build" value="black-mamba">
        <input type="submit" value="Send">
    </form>
`;

describe('forms', () => {
    it('records the fields touched, the last one on abandon, and never a value', () => {
        html(QUOTE);
        const run = boot();

        focus('[name=email]');
        type('[name=email]', CANARY);
        focus('[name=name]');
        type('[name=name]', CANARY);
        transition('pagehide');

        expect(run.events().filter((event) => ['field', 'abandon'].includes(event.type))).toEqual([
            expect.objectContaining({ type: 'field', target: 'email', form: 'quote' }),
            expect.objectContaining({ type: 'field', target: 'name', form: 'quote' }),
            expect.objectContaining({ type: 'abandon', target: 'name', form: 'quote' }),
        ]);
        expect(run.bodies.join('')).not.toContain('canary');
    });

    it('records each move to a different field, not a refocus of the same one', () => {
        html(QUOTE);
        const run = boot();

        focus('[name=email]');
        focus('[name=email]');
        focus('[name=name]');
        focus('[name=email]');

        expect(run.of('field').map((event) => event.target)).toEqual(['email', 'name', 'email']);
    });

    it('does not abandon a submitted form, unless it is edited again', () => {
        html(QUOTE);
        const run = boot();

        focus('[name=email]');
        $('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
        history.pushState({}, '', '/quote/sent');

        expect(run.of('submit')).toEqual([expect.objectContaining({ form: 'quote' })]);
        expect(run.of('abandon')).toEqual([]);

        html(QUOTE);
        focus('[name=email]');
        $('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
        focus('[name=name]');
        history.pushState({}, '', '/elsewhere');

        expect(run.of('abandon')).toEqual([expect.objectContaining({ view: 2, target: 'name' })]);
    });

    it('groups fields outside a form under no form', () => {
        html(`<input aria-label="Search"><button>Go</button>`);
        const run = boot();

        focus('input');
        transition('pagehide');

        expect(run.events().filter((event) => event.type === 'field' || event.type === 'abandon')).toEqual([
            expect.objectContaining({ type: 'field', target: 'Search', form: null }),
            expect.objectContaining({ type: 'abandon', target: 'Search', form: null }),
        ]);
    });

    it('ignores buttons, hidden inputs and ignored forms', () => {
        html(`${QUOTE}<form data-footprint-ignore><input name="secret"></form><button id="b">x</button>`);
        const run = boot();

        focus('[type=submit]');
        focus('[type=hidden]');
        focus('[name=secret]');
        focus('#b');
        document.querySelector('[data-footprint-ignore]')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));

        expect(run.flush().filter((event) => ['field', 'submit'].includes(event.type))).toEqual([]);
    });

    it('covers selects, textareas and contenteditable', () => {
        html(`<form id="f"><select name="size"></select><textarea name="notes"></textarea><div contenteditable="true" aria-label="Bio"></div></form>`);
        const run = boot();

        focus('select');
        focus('textarea');
        focus('[contenteditable]');

        expect(run.of('field').map(({ target, form }) => [target, form])).toEqual([
            ['size', 'f'],
            ['notes', 'f'],
            ['Bio', 'f'],
        ]);
    });
});
