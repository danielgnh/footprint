import { normalizePath, parse, scrub } from './path';

export const INTERACTIVE = [
    'a[href]',
    'area[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    'label',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="slider"]',
    '[role="combobox"]',
    '[contenteditable="true"]',
    '[tabindex="0"]',
    '[onclick]',
    '[data-footprint]',
].join(',');

export const SECTION = '[data-footprint-section]';
export const LANDMARK = 'header, footer, section[id], dialog';

const NAME = 60;

function text(element: Element | null): string | null {
    return element === null ? null : scrub(element.textContent, NAME);
}

function attribute(element: Element, name: string, max = NAME): string | null {
    return scrub(element.getAttribute(name), max);
}

export function ignored(element: Element): boolean {
    return element.closest('[data-footprint-ignore]') !== null;
}

export function interactive(element: Element): Element | null {
    return element.closest(INTERACTIVE);
}

function labelledBy(element: Element): string | null {
    const ids = element.getAttribute('aria-labelledby');

    if (ids === null) {
        return null;
    }

    const label = ids
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' ');

    return scrub(label, NAME);
}

export function isField(element: Element): boolean {
    if (element instanceof HTMLInputElement) {
        return !['hidden', 'submit', 'button', 'reset', 'image'].includes(element.type);
    }

    return element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || element.getAttribute('contenteditable') === 'true';
}

export function fieldName(element: Element): string {
    const labels = (element as HTMLInputElement).labels;

    return attribute(element, 'data-footprint')
        ?? attribute(element, 'name')
        ?? (labels && labels.length > 0 ? text(labels[0]) : null)
        ?? attribute(element, 'aria-label')
        ?? labelledBy(element)
        ?? attribute(element, 'id')
        ?? element.tagName.toLowerCase();
}

export function formName(form: Element | null): string | null {
    if (form === null) {
        return null;
    }

    const action = parse(form.getAttribute('action') ?? '', form.ownerDocument.location.href);

    return attribute(form, 'data-footprint', 100)
        ?? attribute(form, 'aria-label', 100)
        ?? attribute(form, 'name', 100)
        ?? attribute(form, 'id', 100)
        ?? (action === null || !form.hasAttribute('action') ? null : normalizePath(action.pathname));
}

function choice(element: Element): string | null {
    if (!(element instanceof HTMLInputElement) || !['radio', 'checkbox'].includes(element.type)) {
        return null;
    }

    const labels = element.labels;

    return attribute(element, 'data-footprint') ?? (labels && labels.length > 0 ? text(labels[0]) : null);
}

export function nameOf(element: Element): string {
    if (isField(element)) {
        return choice(element) ?? fieldName(element);
    }

    const image = element.querySelector('img[alt]');

    return attribute(element, 'data-footprint')
        ?? attribute(element, 'aria-label')
        ?? labelledBy(element)
        ?? text(element)
        ?? (image === null ? null : attribute(image, 'alt'))
        ?? text(element.querySelector('svg title'))
        ?? attribute(element, 'title')
        ?? element.tagName.toLowerCase();
}

export function deadName(element: Element): string {
    const named = element.closest('[data-footprint]');
    const image = element instanceof HTMLImageElement ? element : element.closest('picture')?.querySelector('img') ?? null;

    return (named === null ? null : attribute(named, 'data-footprint'))
        ?? (image === null ? null : attribute(image, 'alt'))
        ?? text(element.closest('h1, h2, h3, h4, h5, h6'))
        ?? element.tagName.toLowerCase();
}

export function sectionName(element: Element): string {
    return attribute(element, 'data-footprint-section', 100)
        ?? attribute(element, 'id', 100)
        ?? attribute(element, 'aria-label', 100)
        ?? element.tagName.toLowerCase();
}

export function sectionOf(element: Element): Element | null {
    return element.closest(`${SECTION}, ${LANDMARK}`);
}
