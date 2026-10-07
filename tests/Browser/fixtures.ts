import { test as base, expect, type Page } from '@playwright/test';
import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Batch, FootprintEvent } from '../../resources/js/tracker/types';

const root = fileURLToPath(new URL('../..', import.meta.url));
const validate = new Ajv({ allErrors: true }).compile<Batch>(JSON.parse(readFileSync(`${root}/contract/batch.schema.json`, 'utf8')));

export interface Received {
    body: string;
    batch: Batch;
    headers: Record<string, string | null>;
}

interface Fixtures {
    automation: boolean;
    run: string;
    open(path: string, query?: Record<string, string>): Promise<void>;
    received(): Promise<Received[]>;
    events(): Promise<FootprintEvent[]>;
    flush(): Promise<void>;
    settle(done: (events: FootprintEvent[]) => boolean, timeout?: number): Promise<FootprintEvent[]>;
    record: void;
}

export const test = base.extend<Fixtures>({
    automation: [false, { option: true }],

    run: async ({}, use, info) => {
        await use(`${info.project.name}-${info.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    },

    page: async ({ page, automation }, use) => {
        const errors: string[] = [];

        if (!automation) {
            await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }));
        }

        page.on('pageerror', (error) => errors.push(error.message));

        await use(page);

        expect(errors, 'uncaught errors in the page').toEqual([]);
    },

    open: async ({ page, run }, use) => {
        await use(async (path, query = {}) => {
            const params = new URLSearchParams({ run, ...query });
            await page.goto(`${path}${path.includes('?') ? '&' : '?'}${params}`);
        });
    },

    received: async ({ request, run }, use) => {
        await use(async () => {
            const items: Array<{ body: string; headers: Record<string, string | null> }> = await (await request.get(`/_received?run=${encodeURIComponent(run)}`)).json();

            return items.map((item) => {
                const batch = JSON.parse(item.body);

                if (!validate(batch)) {
                    throw new Error(`A batch broke the contract: ${JSON.stringify(validate.errors)}\n${item.body}`);
                }

                return { ...item, batch };
            });
        });
    },

    events: async ({ received }, use) => {
        await use(async () => (await received()).flatMap((item) => item.batch.events));
    },

    flush: async ({ page }, use) => {
        await use(async () => {
            await page.evaluate(() => window.footprint?.flush?.());
        });
    },

    settle: async ({ events }, use) => {
        await use(async (done, timeout = 5_000) => {
            const until = Date.now() + timeout;
            let current = await events();

            while (!done(current) && Date.now() < until) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                current = await events();
            }

            return current;
        });
    },

    record: [
        async ({ received }, use, info) => {
            await use();

            if (process.env.RECORD !== '1' || info.status !== info.expectedStatus) {
                return;
            }

            const batches = (await received()).map((item) => item.batch);

            if (batches.length === 0) {
                return;
            }

            const ids = new Map<string, string>();
            const stable = (id: string): string => {
                if (!ids.has(id)) {
                    const hex = createHash('sha1').update(`${info.titlePath.join('/')}#${ids.size}`).digest('hex');
                    ids.set(id, `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`);
                }

                return ids.get(id)!;
            };

            const slug = info.titlePath.slice(1).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
            const file = `${root}/contract/fixtures/${info.project.name}/${slug}.json`;

            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, `${JSON.stringify(batches.map((batch) => ({ ...batch, visit: { ...batch.visit, id: stable(batch.visit.id) } })), null, 2)}\n`);
        },
        { auto: true },
    ],
});

export { expect };

export const of = <T extends FootprintEvent['type']>(events: FootprintEvent[], type: T) =>
    events.filter((event): event is Extract<FootprintEvent, { type: T }> => event.type === type);

export const dwell = (events: FootprintEvent[], section: string | null): number =>
    of(events, 'dwell')
        .filter((event) => event.section === section)
        .reduce((sum, event) => sum + event.value, 0);

export async function scrollToSection(page: Page, name: string): Promise<void> {
    await page.evaluate((section) => {
        const element = document.querySelector(`[data-footprint-section="${section}"]`)!;
        window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY);
    }, name);
}

export async function scrollToBottom(page: Page): Promise<void> {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

export async function hide(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
}

export async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
    const box = (await page.locator(selector).boundingBox())!;

    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
