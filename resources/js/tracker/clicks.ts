import { deadName, ignored, interactive, nameOf, sectionName, sectionOf } from './describe';
import { hrefOf } from './path';
import type { Context } from './types';

export const RAGE_COUNT = 3;
export const RAGE_MS = 700;
export const RAGE_PX = 24;
export const DEAD_MS = 1000;

type Point = { x: number | null; y: number | null };

interface Pending {
    target: string;
    section: string | null;
    point: Point;
    url: string;
    scroll: number;
}

function round(value: number): number {
    return Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000;
}

function point(event: MouseEvent, section: Element | null): Point {
    if (section !== null) {
        const box = section.getBoundingClientRect();

        if (box.width > 0 && box.height > 0) {
            return { x: round((event.clientX - box.left) / box.width), y: round((event.clientY - box.top) / box.height) };
        }
    }

    const root = document.documentElement;

    return {
        x: root.clientWidth > 0 ? round(event.clientX / root.clientWidth) : null,
        y: root.scrollHeight > 0 ? round((event.clientY + window.scrollY) / root.scrollHeight) : null,
    };
}

function origin(event: Event): Element | null {
    const target = event.target;

    if (target instanceof Element) {
        return target;
    }

    return target instanceof Node ? target.parentElement : null;
}

function selecting(): boolean {
    return String(window.getSelection?.() ?? '').length > 0;
}

export function clicks(ctx: Context): void {
    let label: { control: Element | null; t: number } | null = null;
    let burst: { x: number; y: number; start: number; count: number } | null = null;
    let pending: Pending[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const watcher = new MutationObserver(
        ctx.guard(() => {
            pending = [];
            watcher.disconnect();
        }),
    );

    const later = (fn: () => void, ms: number): void => {
        const timer = setTimeout(
            ctx.guard(() => {
                timers.delete(timer);
                fn();
            }),
            ms,
        );
        timers.add(timer);
    };

    const watchDead = (entry: Pending): void => {
        if (pending.length === 0) {
            watcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        }

        pending.push(entry);

        later(() => {
            const index = pending.indexOf(entry);

            if (index === -1) {
                return;
            }

            pending.splice(index, 1);

            if (pending.length === 0) {
                watcher.disconnect();
            }

            if (location.href === entry.url && Math.abs(window.scrollY - entry.scroll) < 2 && !selecting()) {
                ctx.emit({ type: 'dead', target: entry.target, section: entry.section, x: entry.point.x, y: entry.point.y });
            }
        }, DEAD_MS);
    };

    ctx.listen(
        document,
        'click',
        (event: MouseEvent) => {
            const element = origin(event);

            if (element === null || ignored(element)) {
                return;
            }

            const target = interactive(element);
            const section = sectionOf(element);
            const keyboard = event.detail === 0;
            const at = keyboard ? { x: null, y: null } : point(event, section);
            const name = section === null ? null : sectionName(section);

            if (target === null) {
                if (!keyboard && element !== document.documentElement && element !== document.body && !selecting()) {
                    watchDead({ target: deadName(element), section: name, point: at, url: location.href, scroll: window.scrollY });
                }

                return;
            }

            if (label !== null && label.control === target && ctx.now() - label.t < 100) {
                label = null;

                return;
            }

            label = target instanceof HTMLLabelElement ? { control: target.control, t: ctx.now() } : null;

            ctx.emit({
                type: 'click',
                target: nameOf(target),
                href: target.matches('a[href], area[href]') ? hrefOf(target, location) : null,
                section: name,
                x: at.x,
                y: at.y,
            });
        },
        true,
    );

    ctx.listen(
        document,
        'pointerdown',
        (event: PointerEvent) => {
            const element = origin(event);

            if (!event.isPrimary || event.button !== 0 || element === null || ignored(element)) {
                return;
            }

            const t = ctx.now();

            if (burst === null || t - burst.start > RAGE_MS || Math.hypot(event.clientX - burst.x, event.clientY - burst.y) > RAGE_PX) {
                burst = { x: event.clientX, y: event.clientY, start: t, count: 1 };

                return;
            }

            burst.count++;

            if (burst.count !== RAGE_COUNT) {
                return;
            }

            const section = sectionOf(element);
            const target = interactive(element);
            const at = point(event, section);

            later(() => {
                if (!selecting()) {
                    ctx.emit({
                        type: 'rage',
                        target: target === null ? deadName(element) : nameOf(target),
                        section: section === null ? null : sectionName(section),
                        x: at.x,
                        y: at.y,
                    });
                }
            }, 0);
        },
        true,
    );

    ctx.on('viewend', () => {
        pending = [];
        watcher.disconnect();
    });

    ctx.cleanup(() => {
        watcher.disconnect();
        timers.forEach(clearTimeout);
    });
}
