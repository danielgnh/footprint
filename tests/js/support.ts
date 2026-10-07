import Ajv from 'ajv';
import { afterEach, beforeEach, vi } from 'vitest';
import schema from '../../contract/batch.schema.json';
import { start, type Tracker } from '../../resources/js/tracker/tracker';
import type { Batch, FootprintEvent, Options } from '../../resources/js/tracker/types';

const validate = new Ajv({ allErrors: true }).compile<Batch>(schema);

export function assertContract(batch: unknown): asserts batch is Batch {
    if (!validate(batch)) {
        throw new Error(`Batch breaks the contract: ${JSON.stringify(validate.errors, null, 2)}\n${JSON.stringify(batch, null, 2)}`);
    }
}

export class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];
    targets = new Set<Element>();

    constructor(
        public callback: (entries: Partial<IntersectionObserverEntry>[]) => void,
        public options: IntersectionObserverInit,
    ) {
        FakeIntersectionObserver.instances.push(this);
    }

    observe(element: Element): void {
        this.targets.add(element);
    }

    unobserve(element: Element): void {
        this.targets.delete(element);
    }

    disconnect(): void {
        this.targets.clear();
    }

    static show(element: Element, ratio: number, height = ratio * 400, viewport = 800): void {
        for (const observer of FakeIntersectionObserver.instances) {
            if (observer.targets.has(element)) {
                observer.callback([
                    {
                        target: element,
                        isIntersecting: ratio > 0,
                        intersectionRatio: ratio,
                        intersectionRect: { height } as DOMRectReadOnly,
                        rootBounds: { height: viewport } as DOMRectReadOnly,
                    },
                ]);
            }
        }
    }
}

const running: Tracker[] = [];

export interface Booted {
    tracker: Tracker;
    batches: Batch[];
    bodies: string[];
    events(): FootprintEvent[];
    flush(): FootprintEvent[];
    of<T extends FootprintEvent['type']>(type: T): Extract<FootprintEvent, { type: T }>[];
}

export function boot(options: Partial<Options> = {}): Booted {
    const batches: Batch[] = [];
    const bodies: string[] = [];

    const tracker = start({
        endpoint: '/footprint/events',
        transport: (_url, body) => {
            const batch = JSON.parse(body);
            assertContract(batch);
            bodies.push(body);
            batches.push(batch);

            return true;
        },
        ...options,
    });

    running.push(tracker);

    const events = () => batches.flatMap((batch) => batch.events);

    return {
        tracker,
        batches,
        bodies,
        events,
        flush: () => {
            tracker.flush();

            return events();
        },
        of: (type) => {
            tracker.flush();

            return events().filter((event) => event.type === type) as never;
        },
    };
}

export function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

export function rect(element: Element, box: { left: number; top: number; width: number; height: number }): void {
    element.getBoundingClientRect = () =>
        ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box }) as DOMRect;
}

export function fakeNavigator(overrides: Record<string, unknown>): Navigator {
    return Object.create(
        navigator,
        Object.fromEntries(Object.entries({ webdriver: false, ...overrides }).map(([key, value]) => [key, { value, configurable: true }])),
    );
}

export function transition(type: 'pagehide' | 'pageshow', persisted = false): void {
    window.dispatchEvent(Object.assign(new Event(type), { persisted }));
}

export function html(markup: string): void {
    document.body.innerHTML = markup;
}

export function $(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`No element for ${selector}`);
    }

    return element;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    FakeIntersectionObserver.instances = [];
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://example.test/start');
    document.addEventListener('click', preventNavigation);
});

function preventNavigation(event: Event): void {
    if (event.target instanceof Element && event.target.closest('a, area')) {
        event.preventDefault();
    }
}

afterEach(() => {
    running.splice(0).forEach((tracker) => tracker.stop());
    document.removeEventListener('click', preventNavigation);
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
