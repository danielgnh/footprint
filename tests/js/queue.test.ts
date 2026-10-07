import { describe, expect, it, vi } from 'vitest';
import { beacon, createQueue } from '../../resources/js/tracker/queue';
import type { FootprintEvent, Visit } from '../../resources/js/tracker/types';
import { boot, setVisibility } from './support';

const visit: Visit = { id: '6f1c2c3e-1b2a-4c3d-8e4f-5a6b7c8d9e0f', ref: null, utm: {}, device: 'desktop', vw: 1200, lang: 'en' };
const event = (i: number, extra = ''): FootprintEvent => ({ t: i, view: 1, path: '/', type: 'custom', name: 'e', props: { i, extra } });

describe('flush triggers', () => {
    it('sends once 50 events are buffered', () => {
        const run = boot();

        for (let i = 0; i < 49; i++) {
            run.tracker.track('tick');
        }

        expect(run.batches).toHaveLength(1);
        expect(run.batches[0].events).toHaveLength(50);
    });

    it('sends on the 15 second interval', () => {
        const run = boot();

        vi.advanceTimersByTime(14_999);
        expect(run.batches).toHaveLength(0);

        vi.advanceTimersByTime(1);
        expect(run.batches).toHaveLength(1);
    });

    it('sends when the page is hidden', () => {
        const run = boot();

        setVisibility('hidden');

        expect(run.batches).toHaveLength(1);
    });

    it('sends nothing while there is nothing to send', () => {
        const run = boot();

        vi.advanceTimersByTime(15_000);
        setVisibility('hidden');
        vi.advanceTimersByTime(60_000);

        expect(run.batches).toHaveLength(1);
    });
});

describe('queue', () => {
    const queue = (transport: (url: string, body: string) => boolean, maxEvents = 10_000) =>
        createQueue({ endpoint: '/e', visit, transport, maxEvents, beforeFlush: () => undefined, debug: false });

    it('splits into batches of at most 200 events, in order', () => {
        const sent: FootprintEvent[][] = [];
        const q = queue((_url, body) => {
            sent.push(JSON.parse(body).events);

            return true;
        });

        for (let i = 0; i < 450; i++) {
            q.push(event(i));
        }

        q.flush();

        expect(sent.map((batch) => batch.length)).toEqual([200, 200, 50]);
        expect(sent.flat().map((e) => e.t)).toEqual([...Array(450).keys()]);
    });

    it('halves a batch until it fits in 60 kB', () => {
        const sizes: number[] = [];
        let count = 0;
        const q = queue((_url, body) => {
            sizes.push(new TextEncoder().encode(body).length);
            count += JSON.parse(body).events.length;

            return true;
        });

        for (let i = 0; i < 200; i++) {
            q.push(event(i, 'é'.repeat(400)));
        }

        q.flush();

        expect(Math.max(...sizes)).toBeLessThanOrEqual(60_000);
        expect(count).toBe(200);
    });

    it('keeps the buffer when the transport refuses, and tries once per flush', () => {
        const transport = vi.fn().mockReturnValue(false);
        const q = queue(transport);

        q.push(event(1));
        q.flush();
        q.flush();

        expect(transport).toHaveBeenCalledTimes(2);
        expect(q.size()).toBe(1);

        transport.mockReturnValue(true);
        q.flush();

        expect(q.size()).toBe(0);
    });

    it('caps the buffer at 1000 events, dropping the oldest', () => {
        const bodies: string[] = [];
        const q = queue(() => false);

        for (let i = 0; i < 1500; i++) {
            q.push(event(i));
        }

        expect(q.size()).toBe(1000);

        const ok = queue((_url, body) => {
            bodies.push(body);

            return true;
        });
        ok.push(event(1));
        ok.flush();
        expect(bodies).toHaveLength(1);
    });

    it('does not flush recursively when beforeFlush pushes', () => {
        const transport = vi.fn().mockReturnValue(true);
        let q: ReturnType<typeof createQueue>;
        q = createQueue({
            endpoint: '/e',
            visit,
            transport,
            maxEvents: 1,
            beforeFlush: () => q.push(event(99)),
            debug: false,
        });

        q.push(event(1));

        expect(transport).toHaveBeenCalledTimes(1);
        expect(JSON.parse(transport.mock.calls[0][1]).events).toHaveLength(2);
    });
});

describe('beacon transport', () => {
    it('uses sendBeacon with a text/plain body', async () => {
        const sendBeacon = vi.fn().mockReturnValue(true);
        const fetch = vi.fn();
        vi.stubGlobal('navigator', { ...navigator, sendBeacon });
        vi.stubGlobal('fetch', fetch);

        expect(beacon('/e', '{"a":1}')).toBe(true);
        expect(sendBeacon).toHaveBeenCalledWith('/e', expect.any(Blob));
        expect((sendBeacon.mock.calls[0][1] as Blob).type).toBe('text/plain;charset=utf-8');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('falls back to a keepalive fetch without credentials when the beacon is refused or throws', () => {
        const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
        vi.stubGlobal('fetch', fetch);

        vi.stubGlobal('navigator', { ...navigator, sendBeacon: () => false });
        expect(beacon('/e', 'x')).toBe(true);

        vi.stubGlobal('navigator', {
            ...navigator,
            sendBeacon: () => {
                throw new TypeError('quota');
            },
        });
        expect(beacon('/e', 'x')).toBe(true);

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenCalledWith('/e', expect.objectContaining({ method: 'POST', keepalive: true, credentials: 'omit' }));
    });

    it('reports failure when nothing can send', () => {
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        vi.stubGlobal('fetch', () => {
            throw new TypeError('keepalive quota');
        });

        expect(beacon('/e', 'x')).toBe(false);
    });

    it('swallows a rejected fetch', async () => {
        vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

        expect(beacon('/e', 'x')).toBe(true);
        await Promise.resolve();
    });
});
