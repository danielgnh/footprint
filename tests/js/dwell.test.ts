import { describe, expect, it, vi } from 'vitest';
import { $, boot, FakeIntersectionObserver as IO, html, setVisibility } from './support';

const PAGE = `
    <header id="top">Header</header>
    <div data-footprint-section="hero">Hero</div>
    <div data-footprint-section="specs">Specs</div>
    <div data-footprint-section="faq">FAQ</div>
    <footer>Footer</footer>
`;

const dwell = (run: ReturnType<typeof boot>, section: string | null): number =>
    run
        .of('dwell')
        .filter((event) => event.section === section)
        .reduce((sum, event) => sum + event.value, 0);

describe('section reach', () => {
    it('reaches a section once it is half visible, once per view, with its document order', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="specs"]'), 0.3);
        IO.show($('[data-footprint-section="specs"]'), 0.6);
        IO.show($('[data-footprint-section="specs"]'), 0);
        IO.show($('[data-footprint-section="specs"]'), 1);

        expect(run.of('section').map(({ section, i }) => [section, i])).toEqual([['specs', 2]]);
    });

    it('counts a section taller than the viewport once it covers half of it', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="faq"]'), 0.2, 300);
        expect(run.of('section')).toEqual([]);

        IO.show($('[data-footprint-section="faq"]'), 0.25, 400);
        expect(run.of('section').map((event) => event.section)).toEqual(['faq']);
    });

    it('tracks landmarks beside marked sections, but not one that wraps them', () => {
        html(`<main id="wrap"><section id="outer"><div data-footprint-section="inner"></div></section></main>${PAGE}`);
        boot();

        const observed = [...IO.instances[0].targets].map((element) => element.getAttribute('data-footprint-section') ?? element.id ?? element.tagName);

        expect(observed).toEqual(['inner', 'hero', 'specs', 'faq', 'top', '']);
        expect(IO.instances[0].targets.has($('footer'))).toBe(true);
    });

    it('falls back to landmarks when nothing is marked, and skips ignored sections', () => {
        html(`<header></header><section id="faq"></section><section id="account" data-footprint-ignore></section><main></main>`);
        boot();

        expect([...IO.instances[0].targets].map((element) => element.id || element.tagName.toLowerCase())).toEqual(['header', 'faq']);
    });

    it('reaches sections again in a new view, after the new page has rendered', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="hero"]'), 1);
        history.pushState({}, '', '/next');
        html(`<header id="top"></header><div data-footprint-section="gallery"></div>`);
        vi.advanceTimersByTime(100);
        IO.show($('[data-footprint-section="gallery"]'), 1);
        IO.show($('#top'), 1);

        expect(run.of('section').map(({ view, section }) => [view, section])).toEqual([
            [1, 'hero'],
            [2, 'gallery'],
            [2, 'top'],
        ]);
    });
});

describe('dwell', () => {
    it('measures the time a section is seen', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="hero"]'), 1);
        vi.advanceTimersByTime(2000);
        IO.show($('[data-footprint-section="hero"]'), 0.1);
        vi.advanceTimersByTime(5000);

        expect(dwell(run, 'hero')).toBe(2000);
    });

    it('sends deltas, so repeated flushes add up to the total', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="hero"]'), 1);
        vi.advanceTimersByTime(20_000);
        run.tracker.flush();
        vi.advanceTimersByTime(10_000);

        expect(run.of('dwell').filter((event) => event.section === 'hero').length).toBeGreaterThan(1);
        expect(dwell(run, 'hero')).toBe(30_000);
    });

    it('stops while the page is hidden', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="hero"]'), 1);
        vi.advanceTimersByTime(1000);
        setVisibility('hidden');
        vi.advanceTimersByTime(5000);
        setVisibility('visible');
        vi.advanceTimersByTime(1000);

        expect(dwell(run, 'hero')).toBe(2000);
        expect(dwell(run, null)).toBe(2000);
    });

    it('stops after 30 seconds without activity and resumes on the next one', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="hero"]'), 1);
        vi.advanceTimersByTime(45_000);
        window.dispatchEvent(new Event('pointermove'));
        vi.advanceTimersByTime(1000);

        expect(dwell(run, 'hero')).toBe(31_000);
    });

    it('counts overlapping sections independently and the page once', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="hero"]'), 1);
        IO.show($('[data-footprint-section="specs"]'), 0.6);
        vi.advanceTimersByTime(3000);

        expect([dwell(run, 'hero'), dwell(run, 'specs'), dwell(run, null)]).toEqual([3000, 3000, 3000]);
    });

    it('closes a section removed from the page', async () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="faq"]'), 1);
        vi.advanceTimersByTime(1500);
        $('[data-footprint-section="faq"]').remove();
        await vi.advanceTimersByTimeAsync(100);
        vi.advanceTimersByTime(5000);

        expect(dwell(run, 'faq')).toBe(1600);
    });

    it('closes every section when the view ends', () => {
        html(PAGE);
        const run = boot();

        IO.show($('[data-footprint-section="hero"]'), 1);
        vi.advanceTimersByTime(1000);
        history.pushState({}, '', '/next');
        vi.advanceTimersByTime(4000);

        const hero = run.of('dwell').filter((event) => event.section === 'hero');
        expect(hero.map(({ view, value }) => [view, value])).toEqual([[1, 1000]]);
    });

    it('counts page time per view', () => {
        const run = boot();

        vi.advanceTimersByTime(1200);
        history.pushState({}, '', '/next');
        vi.advanceTimersByTime(800);

        const page = run.of('dwell').filter((event) => event.section === null);
        expect(page.map(({ view, value }) => [view, value])).toEqual([
            [1, 1200],
            [2, 800],
        ]);
    });

    it('works without IntersectionObserver', () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        html(PAGE);
        const run = boot();

        vi.advanceTimersByTime(1000);

        expect(run.of('section')).toEqual([]);
        expect(dwell(run, null)).toBe(1000);
    });
});

describe('scroll depth', () => {
    const metrics = (height: number, viewport: number, y: number) => {
        Object.defineProperty(document.documentElement, 'scrollHeight', { value: height, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: viewport, configurable: true });
        Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    };

    it('reports new maxima in steps of ten, once the page has settled', () => {
        metrics(4000, 800, 0);
        const run = boot();

        vi.advanceTimersByTime(300);
        metrics(4000, 800, 1200);
        window.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);
        metrics(4000, 800, 400);
        window.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);
        metrics(4000, 800, 3200);
        window.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);

        expect(run.of('scroll').map((event) => event.value)).toEqual([20, 50, 100]);
        metrics(0, 768, 0);
    });

    it('treats a page shorter than the viewport as fully seen', () => {
        metrics(600, 800, 0);
        const run = boot();

        vi.advanceTimersByTime(300);

        expect(run.of('scroll').map((event) => event.value)).toEqual([100]);
        metrics(0, 768, 0);
    });

    it('starts again in a new view', () => {
        metrics(600, 800, 0);
        const run = boot();

        vi.advanceTimersByTime(300);
        history.pushState({}, '', '/next');
        vi.advanceTimersByTime(300);

        expect(run.of('scroll').map(({ view, value }) => [view, value])).toEqual([
            [1, 100],
            [2, 100],
        ]);
        metrics(0, 768, 0);
    });
});
