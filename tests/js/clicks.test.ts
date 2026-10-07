import { describe, expect, it, vi } from 'vitest';
import { $, boot, html, rect } from './support';

function pointer(element: Element, x: number, y: number, init: PointerEventInit = {}): void {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0, clientX: x, clientY: y, ...init }));
}

function click(element: Element, x = 10, y = 10, detail = 1): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail, clientX: x, clientY: y }));
}

describe('clicks', () => {
    it('records the target, internal href, section and section-relative position', () => {
        html(`<div data-footprint-section="hero"><a id="cta" href="/bikes/gravel/configuration?size=M">Build yours</a></div>`);
        rect($('[data-footprint-section]'), { left: 100, top: 50, width: 400, height: 200 });
        const run = boot();

        click($('#cta'), 200, 200);

        expect(run.of('click')).toEqual([
            expect.objectContaining({ target: 'Build yours', href: '/bikes/gravel/configuration', section: 'hero', x: 0.25, y: 0.75 }),
        ]);
    });

    it('uses the nearest interactive ancestor for nested content', () => {
        html(`<button id="b" aria-label="Open geometry"><svg><path id="p"></path></svg></button>`);
        const run = boot();

        click($('#p'));

        expect(run.of('click')[0].target).toBe('Open geometry');
    });

    it('keeps only the host of an external link and the scheme of mailto', () => {
        html(`<a id="ig" href="https://www.instagram.com/irondeer">Instagram</a><a id="mail" href="mailto:hello@irondeer.pt">hello@irondeer.pt</a>`);
        const run = boot();

        click($('#ig'));
        click($('#mail'));

        expect(run.of('click').map(({ target, href }) => [target, href])).toEqual([
            ['Instagram', 'www.instagram.com'],
            ['{email}', 'mailto:'],
        ]);
    });

    it('places a click inside a fixed section, though its reach and dwell are not counted', () => {
        html(`<header id="top" style="position: fixed"><button id="menu">Menu</button></header>`);
        rect($('#top'), { left: 0, top: 0, width: 400, height: 50 });
        const run = boot();

        click($('#menu'), 100, 25);

        expect(run.of('click')).toEqual([expect.objectContaining({ target: 'Menu', section: 'top', x: 0.25, y: 0.5 })]);
    });

    it('records no position for keyboard activation', () => {
        html(`<button id="b">Send</button>`);
        const run = boot();

        click($('#b'), 0, 0, 0);

        expect(run.of('click')[0]).toEqual(expect.objectContaining({ target: 'Send', x: null, y: null }));
    });

    it('falls back to page-relative position outside any section', () => {
        html(`<button id="b">Send</button>`);
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true });
        Object.defineProperty(document.documentElement, 'scrollHeight', { value: 4000, configurable: true });
        const run = boot();

        click($('#b'), 500, 1000);

        expect(run.of('click')[0]).toEqual(expect.objectContaining({ section: null, x: 0.5, y: 0.25 }));
    });

    it('counts a label click once, not again for the control it activates', () => {
        html(`<label id="l"><input id="r" type="radio" name="size"> M</label>`);
        const run = boot();

        click($('#l'));
        vi.advanceTimersByTime(200);
        click($('#r'));

        expect(run.of('click').map((event) => event.target)).toEqual(['M', 'M']);
    });

    it('drops every click inside an ignored subtree', () => {
        html(`<div data-footprint-ignore><button id="b">Account of Jane</button><p id="p">x</p></div>`);
        const run = boot();

        click($('#b'));
        click($('#p'));
        pointer($('#b'), 10, 10);
        pointer($('#b'), 10, 10);
        pointer($('#b'), 10, 10);
        vi.advanceTimersByTime(2000);

        expect(run.flush().filter((event) => ['click', 'dead', 'rage'].includes(event.type))).toEqual([]);
    });
});

describe('rage clicks', () => {
    const burst = (times: number[], offsets: Array<[number, number]> = []) => {
        html(`<div data-footprint-section="checkout"><button id="b" disabled>Pay</button></div>`);
        const run = boot();
        let previous = 0;

        times.forEach((time, index) => {
            vi.advanceTimersByTime(time - previous);
            previous = time;
            const [dx, dy] = offsets[index] ?? [0, 0];
            pointer($('#b'), 100 + dx, 100 + dy);
        });

        vi.advanceTimersByTime(10);

        return run.of('rage');
    };

    it('fires on the third press within 700 ms and 24 px', () => {
        expect(burst([0, 350, 699])).toEqual([expect.objectContaining({ target: 'Pay', section: 'checkout' })]);
    });

    it('needs three presses', () => {
        expect(burst([0, 300])).toEqual([]);
    });

    it('does not fire when the third press is late', () => {
        expect(burst([0, 350, 701])).toEqual([]);
    });

    it('fires within 24 px and not beyond', () => {
        expect(burst([0, 100, 200], [[0, 0], [23, 0], [0, 23]])).toHaveLength(1);
        expect(burst([0, 100, 200], [[0, 0], [25, 0], [0, 0]])).toEqual([]);
    });

    it('fires once for four presses', () => {
        expect(burst([0, 100, 200, 300])).toHaveLength(1);
    });

    it('ignores secondary buttons and non-primary pointers', () => {
        html(`<button id="b">Pay</button>`);
        const run = boot();

        for (let i = 0; i < 3; i++) {
            pointer($('#b'), 10, 10, { button: 2 });
            pointer($('#b'), 10, 10, { isPrimary: false });
        }

        vi.advanceTimersByTime(10);

        expect(run.of('rage')).toEqual([]);
    });

    it('is not a triple-click that selects text', () => {
        html(`<p id="p">Some paragraph</p>`);
        const run = boot();
        vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Some paragraph' } as Selection);

        pointer($('#p'), 10, 10);
        pointer($('#p'), 10, 10);
        pointer($('#p'), 10, 10);
        vi.advanceTimersByTime(10);

        expect(run.of('rage')).toEqual([]);
    });
});

describe('dead clicks', () => {
    it('fires for a non-interactive target that nothing reacts to', async () => {
        html(`<section id="specs"><img id="i" alt="Black Mamba" src="x.jpg"><p id="p">Text</p></section>`);
        const run = boot();

        click($('#i'));
        click($('#p'));
        await vi.advanceTimersByTimeAsync(1000);

        expect(run.of('dead').map(({ target, section }) => [target, section])).toEqual([
            ['Black Mamba', 'specs'],
            ['p', 'specs'],
        ]);
    });

    it('does not fire when the page mutates in response', async () => {
        html(`<div id="d">Open</div><div id="out"></div>`);
        $('#d').addEventListener('click', () => {
            $('#out').textContent = 'opened';
        });
        const run = boot();

        click($('#d'));
        await vi.advanceTimersByTimeAsync(1000);

        expect(run.of('dead')).toEqual([]);
    });

    it('does not fire when the page navigates or scrolls in response', async () => {
        html(`<div id="nav">Go</div><div id="jump">Jump</div>`);
        $('#nav').addEventListener('click', () => history.pushState(null, '', '/elsewhere'));
        const run = boot();

        click($('#nav'));
        await vi.advanceTimersByTimeAsync(1000);

        html(`<div id="jump">Jump</div>`);
        $('#jump').addEventListener('click', () => {
            Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
        });
        click($('#jump'));
        await vi.advanceTimersByTimeAsync(1000);
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

        expect(run.of('dead')).toEqual([]);
    });

    it('does not fire while text is selected, for keyboard activation, or on the body', async () => {
        html(`<p id="p">Text</p>`);
        const run = boot();

        click($('#p'), 10, 10, 0);
        click(document.body);
        const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Text' } as Selection);
        click($('#p'));
        await vi.advanceTimersByTimeAsync(1000);
        selection.mockRestore();

        expect(run.of('dead')).toEqual([]);
    });

    it('does not fire when the click turned into a word selection before the timeout', async () => {
        html(`<p id="p">Text</p>`);
        const run = boot();

        click($('#p'));
        vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Text' } as Selection);
        await vi.advanceTimersByTimeAsync(1000);

        expect(run.of('dead')).toEqual([]);
    });
});
