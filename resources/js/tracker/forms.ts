import { fieldName, formName, ignored, isField } from './describe';
import type { Context } from './types';

interface FormState {
    name: string | null;
    field: string;
    dirty: boolean;
}

export function forms(ctx: Context): void {
    const states = new Map<Element | null, FormState>();
    let last: Element | null = null;

    const state = (form: Element | null): FormState => {
        let current = states.get(form);

        if (current === undefined) {
            current = { name: formName(form), field: '', dirty: false };
            states.set(form, current);
        }

        return current;
    };

    ctx.listen(
        document,
        'focusin',
        (event: FocusEvent) => {
            const element = event.target;

            if (!(element instanceof Element) || element === last || !isField(element) || ignored(element)) {
                return;
            }

            last = element;

            const form = state((element as HTMLInputElement).form ?? element.closest('form'));
            form.field = fieldName(element);
            form.dirty = true;

            ctx.emit({ type: 'field', target: form.field, form: form.name });
        },
        true,
    );

    ctx.listen(
        document,
        'submit',
        (event: SubmitEvent) => {
            const element = event.target;

            if (!(element instanceof HTMLFormElement) || ignored(element)) {
                return;
            }

            const form = state(element);
            form.dirty = false;

            ctx.emit({ type: 'submit', form: form.name });
        },
        true,
    );

    ctx.on('viewend', () => {
        for (const form of states.values()) {
            if (form.dirty) {
                ctx.emit({ type: 'abandon', target: form.field, form: form.name });
            }
        }

        states.clear();
        last = null;
    });
}
