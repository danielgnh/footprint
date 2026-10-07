import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sectionName, sectionOf } from '../../resources/js/tracker/describe';
import { $, html } from './support';

// The Statamic Interactions skill tells agents to copy these modules from
// references/page-view.md. This runs that exact code, and checks the overlay
// finds sections by the same names the tracker records.

type Modules = {
    sections: { sectionsIn(doc: Document): Map<string, Element> };
    overlay: { drawOverlay(doc: Document, sections: Map<string, Element>, options: object): void; clearOverlay(doc: Document): void };
    timeline: {
        timeline(events: object[], path: string): Array<{ at: number; event: { type: string } }>;
        exit(events: object[], path: string): string | null;
    };
};

const modules = {} as Modules;

beforeAll(async () => {
    const markdown = readFileSync(resolve('resources/boost/skills/footprint-statamic-interactions/references/page-view.md'), 'utf8');
    const directory = resolve('node_modules/.cache/footprint-skill');
    mkdirSync(directory, { recursive: true });

    for (const [, name, code] of markdown.matchAll(/```js\n\/\/ resources\/js\/cp\/interactions\/(\w+)\.js\n([\s\S]*?)```/g)) {
        const file = join(directory, `${name}.mjs`);
        writeFileSync(file, code);
        (modules as Record<string, unknown>)[name] = await import(/* @vite-ignore */ file);
    }
});

describe('the documented page view', () => {
    it('ships all three modules', () => {
        expect(Object.keys(modules).sort()).toEqual(['overlay', 'sections', 'timeline']);
    });

    it('names sections exactly as the tracker does', () => {
        html(`
            <header id="top"><button id="a">Menu</button></header>
            <main>
                <div data-footprint-section="hero"><button id="b">Go</button></div>
                <section id="faq"><button id="c">Q</button></section>
                <section id="wrap"><div data-footprint-section="inner"><button id="d">In</button></div></section>
            </main>
            <footer><button id="e">Legal</button></footer>
            <dialog aria-label="Geometry"><button id="f">Close</button></dialog>
        `);

        const found = modules.sections.sectionsIn(document);

        for (const id of ['#a', '#b', '#c', '#d', '#e', '#f']) {
            const section = sectionOf($(id))!;
            expect(found.get(sectionName(section))).toBe(section);
        }

        expect([...found.keys()]).toEqual(['top', 'hero', 'faq', 'inner', 'footer', 'Geometry']);
    });

    it('draws attention and frustration layers inside the page, ignored by the tracker', () => {
        html(`<div data-footprint-section="hero">Hero</div><div data-footprint-section="gone-from-page"></div>`);
        $('[data-footprint-section="hero"]').getBoundingClientRect = () => ({ left: 0, top: 100, width: 400, height: 200 }) as DOMRect;

        modules.overlay.drawOverlay(document, modules.sections.sectionsIn(document), {
            rows: [
                { section: 'hero', reach: 0.8, median_ms: 12_000 },
                { section: 'removed', reach: 0.4, median_ms: 3_000 },
            ],
            points: [
                { section: 'hero', type: 'rage', target: 'Pay', x: 0.5, y: 0.5 },
                { section: 'hero', type: 'dead', target: 'img', x: 0.25, y: 0.75 },
            ],
            layers: { attention: true, clicks: false, frustration: true },
        });

        const root = document.querySelector('[data-footprint-overlay]')!;

        expect(root.hasAttribute('data-footprint-ignore')).toBe(true);
        expect(root.children).toHaveLength(1);
        expect(root.textContent).toContain('80% reached · 12 s');
        expect(root.querySelectorAll('[title]')).toHaveLength(2);
        expect((root.querySelector('[title^="Rage"]') as HTMLElement).style.left).toBe('193px');

        modules.overlay.clearOverlay(document);
        expect(document.querySelector('[data-footprint-overlay]')).toBeNull();
    });

    it('builds a playback timeline for one page, capping long pauses', () => {
        const events = [
            { type: 'view', view: 1, t: 0, path: '/spa' },
            { type: 'view', view: 2, t: 1_000, path: '/bikes' },
            { type: 'section', view: 2, t: 1_200, path: '/bikes' },
            { type: 'click', view: 2, t: 31_200, path: '/bikes' },
            { type: 'view', view: 3, t: 32_000, path: '/quote' },
        ];

        const steps = modules.timeline.timeline(events, '/bikes');

        expect(steps.map((step) => [step.event.type, step.at])).toEqual([
            ['view', 0],
            ['section', 200],
            ['click', 2_700],
        ]);
        expect(modules.timeline.exit(events, '/bikes')).toBe('/quote');
        expect(modules.timeline.exit(events, '/quote')).toBeNull();
    });
});
