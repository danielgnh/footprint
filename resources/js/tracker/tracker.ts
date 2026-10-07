import { clicks } from './clicks';
import { forms } from './forms';
import { normalizePath, referrerHost, referrerPath, scrub, utmFrom } from './path';
import { beacon, createQueue } from './queue';
import { scroll } from './scroll';
import { sections } from './sections';
import { Stopwatch } from './stopwatch';
import type { Context, Device, EventBody, FootprintEvent, Hook, Options, PropValue, Visit } from './types';

const CUSTOM = /^[A-Za-z0-9_.:-]{1,60}$/;
const PROP = /^[A-Za-z0-9_.:-]{1,40}$/;
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

export interface Tracker {
    visit: Visit;
    track(name: unknown, props?: unknown): void;
    flush(): void;
    stop(): void;
}

export function uuid(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function device(width: number): Device {
    if (width < 768) {
        return 'mobile';
    }

    return window.matchMedia?.('(pointer: coarse)').matches ? 'tablet' : 'desktop';
}

export function props(input: unknown): Record<string, PropValue> {
    const clean: Record<string, PropValue> = {};

    if (input === null || typeof input !== 'object') {
        return clean;
    }

    for (const [key, value] of Object.entries(input)) {
        if (Object.keys(clean).length === 10) {
            break;
        }

        if (!PROP.test(key)) {
            continue;
        }

        if (typeof value === 'string') {
            clean[key] = scrub(value, 100);
        } else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || value === null) {
            clean[key] = value;
        }
    }

    return clean;
}

export function start(options: Options): Tracker {
    const origin = performance.now();
    const hooks: Record<Hook, Array<() => void>> = { viewstart: [], viewend: [], beforeflush: [], activity: [] };
    const cleanups: Array<() => void> = [];
    const idleAfter = options.idleAfter ?? 30_000;

    const visit: Visit = {
        id: uuid(),
        ref: referrerHost(document.referrer, location.origin),
        utm: utmFrom(location.search),
        device: device(window.innerWidth),
        vw: Math.min(10_000, Math.floor(window.innerWidth / 50) * 50),
        lang: scrub(document.documentElement.lang, 20),
    };

    let view = 0;
    let path = normalizePath(location.pathname);
    let ended = false;
    let visible = document.visibilityState !== 'hidden';
    let idle = false;
    let last = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const now = (): number => Math.min(86_400_000, Math.max(0, Math.round(performance.now() - origin)));

    const guard =
        <A extends unknown[]>(fn: (...args: A) => void) =>
        (...args: A): void => {
            try {
                fn(...args);
            } catch (error) {
                if (options.debug) {
                    console.error('[footprint]', error);
                }
            }
        };

    const fire = (hook: Hook): void => hooks[hook].forEach((callback) => guard(callback)());

    const queue = createQueue({
        endpoint: options.endpoint,
        visit,
        transport: options.transport ?? beacon,
        maxEvents: options.maxEvents ?? 50,
        beforeFlush: () => fire('beforeflush'),
        debug: options.debug ?? false,
    });

    const emit = (body: EventBody): void => {
        if (view > 0) {
            queue.push({ t: now(), view, path, ...body } as FootprintEvent);
        }
    };

    const active = (): boolean => visible && !idle && !ended;

    const ctx: Context = {
        now,
        emit,
        active,
        guard,
        on: (hook, callback) => hooks[hook].push(callback),
        listen: (target, type, handler, listenerOptions) => {
            const wrapped = guard(handler);
            target.addEventListener(type, wrapped, listenerOptions);
            cleanups.push(() => target.removeEventListener(type, wrapped, listenerOptions));
        },
        cleanup: (fn) => cleanups.push(fn),
        flush: () => queue.flush(),
    };

    const checkIdle = (): void => {
        idleTimer = undefined;
        const quiet = now() - last;

        if (quiet >= idleAfter) {
            idle = true;
            fire('activity');
        } else {
            idleTimer = setTimeout(guard(checkIdle), idleAfter - quiet);
        }
    };

    const touch = (): void => {
        last = now();

        if (idle) {
            idle = false;
            fire('activity');
        }

        if (idleTimer === undefined) {
            idleTimer = setTimeout(guard(checkIdle), idleAfter);
        }
    };

    const startView = (from: string | null): void => {
        view = Math.min(view + 1, 10_000);
        path = normalizePath(location.pathname);
        emit({ type: 'view', from });
        fire('viewstart');
    };

    const check = (): void => {
        const next = normalizePath(location.pathname);

        if (ended || next === path) {
            return;
        }

        const from = path;
        fire('viewend');
        startView(from);
    };

    const page = new Stopwatch();

    const pageDwell = (): void => {
        const value = page.take(now());

        if (value >= 1) {
            emit({ type: 'dwell', section: null, value });
        }
    };

    ctx.on('activity', () => (active() ? page.run(now()) : page.pause(now())));
    ctx.on('viewstart', () => active() && page.run(now()));
    ctx.on('beforeflush', pageDwell);
    ctx.on('viewend', () => {
        pageDwell();
        page.pause(now());
    });

    sections(ctx);
    scroll(ctx);
    clicks(ctx);
    forms(ctx);

    for (const method of ['pushState', 'replaceState'] as const) {
        const original = history[method];

        history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
            const result = original.apply(this, args);
            guard(check)();

            return result;
        };

        cleanups.push(() => {
            history[method] = original;
        });
    }

    ctx.listen(window, 'popstate', check);

    ctx.listen(document, 'visibilitychange', () => {
        visible = document.visibilityState !== 'hidden';

        if (visible) {
            touch();
        }

        fire('activity');

        if (!visible) {
            queue.flush();
        }
    });

    ctx.listen(window, 'pagehide', () => {
        if (!ended) {
            fire('viewend');
            ended = true;
            fire('activity');
        }

        queue.flush();
    });

    ctx.listen(window, 'pageshow', (event: PageTransitionEvent) => {
        if (event.persisted && ended) {
            ended = false;
            visible = document.visibilityState !== 'hidden';
            touch();
            startView(null);
            fire('activity');
        }
    });

    for (const type of ACTIVITY) {
        ctx.listen(window, type, touch, { passive: true, capture: true });
    }

    const interval = setInterval(guard(queue.flush), options.flushInterval ?? 15_000);

    startView(referrerPath(document.referrer, location.origin));
    touch();
    fire('activity');

    return {
        visit,
        track: guard((name: unknown, input?: unknown) => {
            if (typeof name === 'string' && CUSTOM.test(name)) {
                emit({ type: 'custom', name, props: props(input) });
            }
        }),
        flush: guard(queue.flush),
        stop: () => {
            clearInterval(interval);
            clearTimeout(idleTimer);
            cleanups.forEach((fn) => fn());
        },
    };
}
