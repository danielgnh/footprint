import type { Context } from './types';

export function scroll(ctx: Context): void {
    let max = 0;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const measure = (): void => {
        frame = 0;
        const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
        const ratio = height > 0 ? Math.min(1, (window.scrollY + window.innerHeight + 2) / height) : 1;
        const bucket = Math.floor(ratio * 10) * 10;

        if (bucket > max) {
            max = bucket;
            ctx.emit({ type: 'scroll', value: bucket });
        }
    };

    const request = (): void => {
        if (frame === 0) {
            frame = requestAnimationFrame(ctx.guard(measure));
        }
    };

    const settle = (): void => {
        clearTimeout(timer);

        if (document.readyState === 'complete') {
            timer = setTimeout(ctx.guard(measure), 250);
        } else {
            ctx.listen(window, 'load', () => setTimeout(ctx.guard(measure), 250), { once: true });
        }
    };

    ctx.listen(window, 'scroll', request, { passive: true });

    ctx.on('viewstart', () => {
        max = 0;
        settle();
    });

    ctx.cleanup(() => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
    });
}
