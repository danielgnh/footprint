export type Device = 'mobile' | 'tablet' | 'desktop';

export interface Utm {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
}

export interface Visit {
    id: string;
    ref: string | null;
    utm: Utm;
    device: Device;
    vw: number;
    lang: string | null;
}

export type PropValue = string | number | boolean | null;

export type EventBody =
    | { type: 'view'; from: string | null }
    | { type: 'section'; section: string; i: number }
    | { type: 'dwell'; section: string | null; value: number }
    | { type: 'scroll'; value: number }
    | { type: 'click'; target: string; href: string | null; section: string | null; x: number | null; y: number | null }
    | { type: 'rage'; target: string; section: string | null; x: number | null; y: number | null }
    | { type: 'dead'; target: string; section: string | null; x: number | null; y: number | null }
    | { type: 'field'; target: string; form: string | null }
    | { type: 'abandon'; target: string; form: string | null }
    | { type: 'submit'; form: string | null }
    | { type: 'custom'; name: string; props: Record<string, PropValue> };

export type FootprintEvent = { t: number; view: number; path: string } & EventBody;

export interface Batch {
    v: 1;
    visit: Visit;
    events: FootprintEvent[];
}

export type Transport = (url: string, body: string) => boolean;

export interface Options {
    endpoint: string;
    transport?: Transport;
    flushInterval?: number;
    maxEvents?: number;
    idleAfter?: number;
    debug?: boolean;
}

export type Hook = 'viewstart' | 'viewend' | 'beforeflush' | 'activity';

export interface Context {
    now(): number;
    emit(body: EventBody): void;
    active(): boolean;
    on(hook: Hook, callback: () => void): void;
    listen(target: EventTarget, type: string, handler: (event: any) => void, options?: AddEventListenerOptions | boolean): void;
    guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
    cleanup(fn: () => void): void;
    flush(): void;
}
