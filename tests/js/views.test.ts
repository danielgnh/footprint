import { describe, expect, it } from 'vitest';
import { boot, transition } from './support';

const silently = (path: string): void => History.prototype.replaceState.call(history, null, '', path);

describe('views', () => {
    it('opens the first view with no previous path', () => {
        const run = boot();

        expect(run.of('view')).toEqual([expect.objectContaining({ view: 1, path: '/start', from: null })]);
    });

    it('takes the previous path from a same-origin referrer', () => {
        Object.defineProperty(document, 'referrer', { value: 'https://example.test/bikes/gravel?size=M', configurable: true });
        const run = boot();

        expect(run.of('view')[0].from).toBe('/bikes/gravel');
        expect(run.tracker.visit.ref).toBeNull();
    });

    it('keeps only the host of an external referrer on the visit', () => {
        Object.defineProperty(document, 'referrer', { value: 'https://l.instagram.com/?u=https%3A%2F%2Fexample.test', configurable: true });
        const run = boot();

        expect(run.tracker.visit.ref).toBe('l.instagram.com');
        expect(run.of('view')[0].from).toBeNull();
    });

    it('starts a view when pushState changes the path', () => {
        const run = boot();

        history.pushState({}, '', '/bikes/gravel');

        expect(run.of('view').map(({ view, path, from }) => [view, path, from])).toEqual([
            [1, '/start', null],
            [2, '/bikes/gravel', '/start'],
        ]);
    });

    it('does not start a view for a query-only replaceState', () => {
        const run = boot();

        history.replaceState({}, '', '/start?size=M&finish=gold');
        history.replaceState({}, '', '/start#review');
        history.pushState({}, '', '/start?size=L');

        expect(run.of('view')).toHaveLength(1);
    });

    it('starts a view on popstate', () => {
        const run = boot();

        history.pushState({}, '', '/b');
        silently('/start');
        window.dispatchEvent(new PopStateEvent('popstate'));

        expect(run.of('view').map(({ path, from }) => [path, from])).toEqual([
            ['/start', null],
            ['/b', '/start'],
            ['/start', '/b'],
        ]);
    });

    it('stamps every event with its view and path', () => {
        const run = boot();

        run.tracker.track('a');
        history.pushState({}, '', '/orders/Xk9fQ2LmP0aZ7bR4tY1uW8eV3sD6gH5jN2kL9mQ0');
        run.tracker.track('b');

        expect(run.of('custom').map(({ view, path }) => [view, path])).toEqual([
            [1, '/start'],
            [2, '/orders/{token}'],
        ]);
    });

    it('ends the view and flushes on pagehide, and opens a new one on a back-forward restore', () => {
        const run = boot();

        transition('pagehide', true);
        const sent = run.batches.length;

        transition('pageshow', true);

        expect(sent).toBe(1);
        expect(run.of('view').map(({ view, from }) => [view, from])).toEqual([
            [1, null],
            [2, null],
        ]);
    });

    it('ignores a pageshow that is not a restore', () => {
        const run = boot();

        transition('pageshow');

        expect(run.of('view')).toHaveLength(1);
    });

    it('records the visit context', () => {
        document.documentElement.lang = 'pt-PT';
        Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
        silently('/pt?utm_source=meta&utm_campaign=creators');
        const run = boot();

        expect(run.tracker.visit).toEqual({
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            ref: null,
            utm: { source: 'meta', campaign: 'creators' },
            device: 'mobile',
            vw: 350,
            lang: 'pt-PT',
        });

        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        document.documentElement.lang = '';
    });

    it('gives every visit a fresh id', () => {
        expect(boot().tracker.visit.id).not.toBe(boot().tracker.visit.id);
    });
});
