import type { Batch, FootprintEvent, Transport, Visit } from './types';

const PER_BATCH = 200;
const MAX_BYTES = 60_000;
const MAX_BUFFER = 1_000;

export const beacon: Transport = (url, body) => {
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });

    try {
        if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, blob)) {
            return true;
        }
    } catch {
        // A refused or throwing beacon falls through to fetch.
    }

    try {
        fetch(url, {
            method: 'POST',
            body,
            keepalive: true,
            credentials: 'omit',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        }).catch(() => undefined);

        return true;
    } catch {
        return false;
    }
};

export interface Queue {
    push(event: FootprintEvent): void;
    flush(): void;
    size(): number;
}

export function createQueue(options: {
    endpoint: string;
    visit: Visit;
    transport: Transport;
    maxEvents: number;
    beforeFlush: () => void;
    debug: boolean;
}): Queue {
    const buffer: FootprintEvent[] = [];
    const encoder = new TextEncoder();
    let flushing = false;

    const serialize = (count: number): string => {
        const batch: Batch = { v: 1, visit: options.visit, events: buffer.slice(0, count) };

        if (options.debug) {
            console.debug('[footprint]', batch);
        }

        return JSON.stringify(batch);
    };

    const flush = (): void => {
        if (flushing) {
            return;
        }

        flushing = true;

        try {
            options.beforeFlush();

            while (buffer.length > 0) {
                let count = Math.min(PER_BATCH, buffer.length);
                let body = serialize(count);

                while (encoder.encode(body).length > MAX_BYTES && count > 1) {
                    count = Math.ceil(count / 2);
                    body = serialize(count);
                }

                if (!options.transport(options.endpoint, body)) {
                    break;
                }

                buffer.splice(0, count);
            }
        } finally {
            flushing = false;
        }
    };

    return {
        push(event) {
            buffer.push(event);

            if (buffer.length > MAX_BUFFER) {
                buffer.splice(0, buffer.length - MAX_BUFFER);
            }

            if (buffer.length >= options.maxEvents) {
                flush();
            }
        },
        flush,
        size: () => buffer.length,
    };
}
