import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertContract, boot, fakeNavigator } from './support';

describe('custom events', () => {
    it('accepts a valid name and cleans the props', () => {
        const run = boot();

        run.tracker.track('configurator_option', {
            part: 'wheels',
            handle: 'irondeer-gravel-50',
            price: 650,
            preset: false,
            note: null,
            email: 'jane@example.com',
            long: 'x'.repeat(150),
            nested: { a: 1 },
            list: [1, 2],
            nan: Number.NaN,
            fn: () => 1,
            'bad key!': 'x',
        });

        expect(run.of('custom')[0]).toEqual(
            expect.objectContaining({
                name: 'configurator_option',
                props: { part: 'wheels', handle: 'irondeer-gravel-50', price: 650, preset: false, note: null, email: '{email}', long: 'x'.repeat(100) },
            }),
        );
    });

    it('keeps at most ten props', () => {
        const run = boot();

        run.tracker.track('many', Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i])));

        expect(Object.keys(run.of('custom')[0].props)).toHaveLength(10);
    });

    it.each([[''], ['has space'], ['x'.repeat(61)], [42], [null], [{}]])('drops the invalid name %j', (name) => {
        const run = boot();

        run.tracker.track(name);

        expect(run.of('custom')).toEqual([]);
    });

    it('accepts no props, or props that are not an object', () => {
        const run = boot();

        run.tracker.track('a');
        run.tracker.track('b', 'string');

        expect(run.of('custom').map((event) => event.props)).toEqual([{}, {}]);
    });
});

describe('the script entry', () => {
    const load = async (dataset: Record<string, string> = {}) => {
        const script = document.createElement('script');
        Object.entries(dataset).forEach(([key, value]) => (script.dataset[key] = value));
        Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
        vi.resetModules();
        await import('../../resources/js/tracker/index');
    };

    const beacons = () => {
        const sendBeacon = vi.fn().mockReturnValue(true);
        vi.stubGlobal('navigator', fakeNavigator({ sendBeacon }));

        return sendBeacon;
    };

    afterEach(() => {
        window.footprint = undefined;
        Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
    });

    it('starts, drains the stub queue and posts to the configured endpoint', async () => {
        const sendBeacon = beacons();
        window.footprint = { q: [['early', { a: 1 }]], track: () => undefined };

        await load({ endpoint: '/custom/endpoint' });
        window.footprint!.track('late');
        window.footprint!.flush!();

        const [url, blob] = sendBeacon.mock.calls[0];
        const batch = JSON.parse(await (blob as Blob).text());
        assertContract(batch);

        expect(url).toBe('/custom/endpoint');
        expect(batch.events.flatMap((event) => (event.type === 'custom' ? [event.name] : []))).toEqual(['early', 'late']);
    });

    it('does not start twice', async () => {
        beacons();
        await load();
        const first = window.footprint;
        await load();

        expect(window.footprint).toBe(first);
    });

    it.each([
        ['Global Privacy Control', { globalPrivacyControl: true }, {}],
        ['Do Not Track', { doNotTrack: '1' }, {}],
        ['automation', { webdriver: true }, {}],
        ['a zero sample', {}, { sample: '0' }],
    ])('stays silent under %s', async (_label, flags, dataset) => {
        const sendBeacon = vi.fn().mockReturnValue(true);
        vi.stubGlobal('navigator', fakeNavigator({ sendBeacon, ...flags }));

        await load(dataset);
        window.footprint!.track('x');
        window.footprint!.flush!();
        vi.advanceTimersByTime(60_000);

        expect(sendBeacon).not.toHaveBeenCalled();
    });

    it('ignores Global Privacy Control when the site opts out of honouring it', async () => {
        const sendBeacon = vi.fn().mockReturnValue(true);
        vi.stubGlobal('navigator', fakeNavigator({ sendBeacon, globalPrivacyControl: true }));

        await load({ gpc: 'false' });
        window.footprint!.flush!();

        expect(sendBeacon).toHaveBeenCalled();
    });
});
