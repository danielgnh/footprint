import { LANDMARK, SECTION, ignored, sectionName } from './describe';
import { Stopwatch } from './stopwatch';
import type { Context } from './types';

const THRESHOLDS = [0, 0.01, 0.025, 0.05, ...Array.from({ length: 19 }, (_, i) => Math.round((i + 2) * 5) / 100)];

interface Tracked {
    name: string;
    seen: boolean;
    reached: boolean;
    watch: Stopwatch;
}

export function sections(ctx: Context): void {
    if (typeof IntersectionObserver === 'undefined') {
        return;
    }

    const tracked = new Map<Element, Tracked>();
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const dwell = (state: Tracked): void => {
        const value = state.watch.take(ctx.now());

        if (value >= 1) {
            ctx.emit({ type: 'dwell', section: state.name, value });
        }
    };

    const index = (element: Element): number =>
        [...tracked.keys()]
            .filter((candidate) => candidate.isConnected)
            .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
            .indexOf(element);

    const observer = new IntersectionObserver(
        ctx.guard((entries: IntersectionObserverEntry[]) => {
            for (const entry of entries) {
                const state = tracked.get(entry.target);

                if (state === undefined) {
                    continue;
                }

                const viewport = entry.rootBounds?.height || window.innerHeight;
                const seen = entry.isIntersecting && (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= viewport / 2);

                if (seen === state.seen) {
                    continue;
                }

                state.seen = seen;

                if (!seen) {
                    state.watch.pause(ctx.now());
                    continue;
                }

                if (!state.reached) {
                    state.reached = true;
                    ctx.emit({ type: 'section', section: state.name, i: Math.max(0, index(entry.target)) });
                }

                if (ctx.active()) {
                    state.watch.run(ctx.now());
                }
            }
        }),
        { threshold: THRESHOLDS },
    );

    const forget = (element: Element): void => {
        const state = tracked.get(element);

        if (state !== undefined) {
            dwell(state);
        }

        observer.unobserve(element);
        tracked.delete(element);
    };

    const candidates = (): Set<Element> => {
        const marked = [...document.querySelectorAll(SECTION)];
        const landmarks = [...document.querySelectorAll(LANDMARK)].filter(
            (element) => element.closest(SECTION) === null && element.querySelector(SECTION) === null,
        );

        return new Set([...marked, ...landmarks].filter((element) => !ignored(element)));
    };

    const scan = (): void => {
        timer = undefined;
        const current = candidates();

        for (const element of [...tracked.keys()]) {
            if (!current.has(element) || !element.isConnected) {
                forget(element);
            }
        }

        for (const element of current) {
            if (!tracked.has(element)) {
                tracked.set(element, { name: sectionName(element), seen: false, reached: false, watch: new Stopwatch() });
                observer.observe(element);
            }
        }
    };

    const schedule = (): void => {
        if (timer === undefined) {
            timer = setTimeout(ctx.guard(scan), 100);
        }
    };

    const mutations = new MutationObserver(ctx.guard(schedule));
    mutations.observe(document.documentElement, { childList: true, subtree: true });

    ctx.on('viewstart', () => {
        if (first) {
            first = false;
            scan();
        } else {
            schedule();
        }
    });

    ctx.on('viewend', () => {
        for (const element of [...tracked.keys()]) {
            forget(element);
        }
    });

    ctx.on('beforeflush', () => tracked.forEach(dwell));

    ctx.on('activity', () => {
        const now = ctx.now();

        for (const state of tracked.values()) {
            if (state.seen) {
                ctx.active() ? state.watch.run(now) : state.watch.pause(now);
            }
        }
    });

    ctx.cleanup(() => {
        mutations.disconnect();
        observer.disconnect();
        clearTimeout(timer);
    });
}
