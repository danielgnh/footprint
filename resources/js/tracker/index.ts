import { start } from './tracker';

interface Global {
    started?: boolean;
    q?: unknown[][];
    track(...args: unknown[]): void;
    flush?(): void;
}

declare global {
    interface Window {
        footprint?: Global;
        doNotTrack?: string;
    }

    interface Navigator {
        globalPrivacyControl?: boolean;
    }
}

function blocked(data: DOMStringMap): boolean {
    if (navigator.webdriver) {
        return true;
    }

    if (data.gpc !== 'false' && (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1')) {
        return true;
    }

    const sample = data.sample === undefined ? 1 : Number(data.sample);

    return !(Math.random() < sample);
}

(() => {
    const stub = window.footprint;

    if (stub?.started) {
        return;
    }

    const data = (document.currentScript as HTMLScriptElement | null)?.dataset ?? {};
    const off: Global = { started: true, track: () => undefined, flush: () => undefined };

    try {
        if (blocked(data) || typeof fetch !== 'function' || typeof MutationObserver === 'undefined') {
            window.footprint = off;

            return;
        }

        const tracker = start({ endpoint: data.endpoint || '/footprint/events', debug: data.debug === 'true' });

        window.footprint = { started: true, track: tracker.track, flush: tracker.flush };

        for (const args of stub?.q ?? []) {
            tracker.track(...(args as [unknown, unknown]));
        }
    } catch {
        window.footprint = off;
    }
})();
