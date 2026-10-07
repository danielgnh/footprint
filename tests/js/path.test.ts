import { describe, expect, it } from 'vitest';
import paths from '../../contract/cases/paths.json';
import scrubs from '../../contract/cases/scrub.json';
import { hrefOf, normalizePath, referrerHost, referrerPath, scrub, utmFrom } from '../../resources/js/tracker/path';
import './support';

describe('normalizePath (shared vectors)', () => {
    it.each(paths)('$in', ({ in: input, out }) => {
        expect(normalizePath(input)).toBe(out);
    });
});

describe('scrub (shared vectors)', () => {
    it.each(scrubs)('$in', ({ in: input, max, out }) => {
        expect(scrub(input, max)).toBe(out);
    });

    it('returns null for anything but a string', () => {
        expect(scrub(null, 60)).toBeNull();
        expect(scrub(undefined, 60)).toBeNull();
    });
});

describe('utmFrom', () => {
    it('keeps the four campaign tags and nothing else', () => {
        expect(utmFrom('?utm_source=meta&utm_medium=paid&utm_campaign=creators%20q4&utm_content=v2&utm_term=bike&fbclid=abc')).toEqual({
            source: 'meta',
            medium: 'paid',
            campaign: 'creators q4',
            content: 'v2',
        });
    });

    it('scrubs and truncates values', () => {
        const utm = utmFrom(`?utm_source=jane@example.com&utm_campaign=${'x'.repeat(150)}`);

        expect(utm.source).toBe('{email}');
        expect(utm.campaign).toHaveLength(100);
    });

    it('drops empty tags', () => {
        expect(utmFrom('?utm_source=&utm_medium=%20')).toEqual({});
        expect(utmFrom('')).toEqual({});
    });
});

describe('referrer', () => {
    const origin = 'https://example.test';

    it('keeps only the host of an external referrer', () => {
        expect(referrerHost('https://www.Google.com/search?q=jane%40example.com', origin)).toBe('www.google.com');
        expect(referrerHost('https://example.test/bikes', origin)).toBeNull();
        expect(referrerHost('', origin)).toBeNull();
        expect(referrerHost('android-app://com.google.android.gm/', origin)).toBeNull();
    });

    it('keeps the normalised path of a same-origin referrer', () => {
        expect(referrerPath('https://example.test/bikes/gravel?size=M', origin)).toBe('/bikes/gravel');
        expect(referrerPath('https://www.google.com/', origin)).toBeNull();
        expect(referrerPath('', origin)).toBeNull();
    });
});

describe('hrefOf', () => {
    const href = (value: string): string | null => {
        const anchor = document.createElement('a');
        anchor.setAttribute('href', value);

        return hrefOf(anchor, location);
    };

    it.each([
        ['/bikes/gravel?size=M', '/bikes/gravel'],
        ['bikes/gravel', '/bikes/gravel'],
        ['https://example.test/orders/Xk9fQ2LmP0aZ7bR4tY1uW8eV3sD6gH5jN2kL9mQ0', '/orders/{token}'],
        ['https://www.Instagram.com/irondeer?igsh=abc', 'www.instagram.com'],
        ['mailto:hello@irondeer.pt', 'mailto:'],
        ['tel:+351912345678', 'tel:'],
        ['sms:+351912345678', 'sms:'],
        ['javascript:void(0)', null],
        ['#apply', '#apply'],
        ['/start#apply', '#apply'],
        ['/other#apply', '/other'],
        ['#', '/start'],
        ['#jane@example.com', '#{email}'],
        ['#%E0%A4%A', '#%E0%A4%A'],
    ])('%s → %s', (value, expected) => {
        expect(href(value)).toBe(expected);
    });

    it('is null without an href', () => {
        expect(hrefOf(document.createElement('a'), location)).toBeNull();
    });
});
