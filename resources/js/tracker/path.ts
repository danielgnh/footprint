import type { Utm } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(segment: string): boolean {
    if (segment.includes('@') || /%40/i.test(segment) || UUID.test(segment)) {
        return true;
    }

    return segment.split(/[-_.~]/).some((part) => part.length >= 16 && /[A-Za-z]/.test(part) && /[0-9]/.test(part));
}

export function normalizePath(input: string): string {
    const path = input.split(/[?#]/)[0]
        .split('/')
        .filter((segment) => segment !== '')
        .map((segment) => (secret(segment) ? '{token}' : segment))
        .join('/');

    return Array.from('/' + path).slice(0, 255).join('');
}

const SPACE = /\s+/g;
const EMAIL = /[^ @]+@[^ @]+\.[^ @]+/g;
const NUMBER = /\+?[0-9][0-9 ().\/-]*[0-9]/g;

export function scrub(text: string | null | undefined, max: number): string | null {
    if (typeof text !== 'string') {
        return null;
    }

    const clean = text
        .replace(SPACE, ' ')
        .trim()
        .replace(EMAIL, '{email}')
        .replace(NUMBER, (match) => (match.replace(/[^0-9]/g, '').length >= 5 ? '{n}' : match));

    const cut = Array.from(clean).slice(0, max).join('').trim();

    return cut === '' ? null : cut;
}

export function utmFrom(search: string): Utm {
    const params = new URLSearchParams(search);
    const utm: Utm = {};

    for (const key of ['source', 'medium', 'campaign', 'content'] as const) {
        const value = scrub(params.get(`utm_${key}`), 100);

        if (value !== null) {
            utm[key] = value;
        }
    }

    return utm;
}

export function parse(url: string, base?: string): URL | null {
    try {
        return new URL(url, base);
    } catch {
        return null;
    }
}

function decode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

export function referrerHost(referrer: string, origin: string): string | null {
    const url = parse(referrer);

    if (url === null || !/^https?:$/.test(url.protocol) || url.origin === origin) {
        return null;
    }

    return url.hostname.toLowerCase() || null;
}

export function referrerPath(referrer: string, origin: string): string | null {
    const url = parse(referrer);

    return url !== null && url.origin === origin ? normalizePath(url.pathname) : null;
}

export function hrefOf(anchor: Element, location: Location): string | null {
    const raw = anchor.getAttribute('href');

    if (raw === null) {
        return null;
    }

    const url = parse(raw, location.href);

    if (url === null) {
        return null;
    }

    if (['mailto:', 'tel:', 'sms:'].includes(url.protocol)) {
        return url.protocol;
    }

    if (!/^https?:$/.test(url.protocol)) {
        return null;
    }

    if (url.origin !== location.origin) {
        return url.hostname.toLowerCase() || null;
    }

    const path = normalizePath(url.pathname);

    if (url.hash.length > 1 && path === normalizePath(location.pathname)) {
        const fragment = scrub(decode(url.hash.slice(1)), 100);

        return fragment === null ? path : `#${fragment}`;
    }

    return path;
}
