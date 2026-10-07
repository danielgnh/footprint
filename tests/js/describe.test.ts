import { describe, expect, it } from 'vitest';
import { deadName, fieldName, formName, ignored, interactive, nameOf, sectionName, sectionOf } from '../../resources/js/tracker/describe';
import { $, html } from './support';

describe('nameOf', () => {
    it('prefers data-footprint, then aria-label, then aria-labelledby, then text', () => {
        html(`
            <button id="a" data-footprint="Hero CTA" aria-label="Ignored">Build yours</button>
            <button id="b" aria-label="Open menu"><svg></svg></button>
            <span id="menu-label">Main menu</span><button id="c" aria-labelledby="menu-label"></button>
            <button id="d">  Build
                yours </button>
            <a id="e" href="/x"><img alt="IronDeer logo" src="x.png"></a>
            <button id="f"><svg><title>Close</title></svg></button>
            <button id="g" title="Share"></button>
            <button id="h"></button>
        `);

        expect(nameOf($('#a'))).toBe('Hero CTA');
        expect(nameOf($('#b'))).toBe('Open menu');
        expect(nameOf($('#c'))).toBe('Main menu');
        expect(nameOf($('#d'))).toBe('Build yours');
        expect(nameOf($('#e'))).toBe('IronDeer logo');
        expect(nameOf($('#f'))).toBe('Close');
        expect(nameOf($('#g'))).toBe('Share');
        expect(nameOf($('#h'))).toBe('button');
    });

    it('keeps parts laid out on their own apart and inline parts joined, whatever CSS hides or transforms', () => {
        html(`
            <button id="a"><span style="display: block">01</span><span style="display: block">Black Mamba</span><span style="display: block">Gloss black</span></button>
            <button id="b"><b>Bu</b>y<br>now</button>
            <button id="c" style="text-transform: uppercase">Build<span style="display: none"> yours</span></button>
            <div id="size"><span style="display: block">Size</span><span style="display: block">M</span></div><button id="d" aria-labelledby="size"></button>
        `);

        expect(nameOf($('#a'))).toBe('01 Black Mamba Gloss black');
        expect(nameOf($('#b'))).toBe('Buy now');
        expect(nameOf($('#c'))).toBe('Build yours');
        expect(nameOf($('#d'))).toBe('Size M');
    });

    it('scrubs and truncates visible text', () => {
        html(`
            <button id="a">Email jane@example.com or call +351 912 345 678</button>
            <a id="b" href="/x">${'Longlabel'.repeat(10)}</a>
        `);

        expect(nameOf($('#a'))).toBe('Email {email} or call {n}');
        expect(Array.from(nameOf($('#b')))).toHaveLength(60);
    });

    it('names a field by its name, never its value', () => {
        html(`
            <label for="email">Your email</label>
            <input id="email" name="email" value="jane@example.com">
            <input id="plain" value="secret">
            <label><input id="radio" type="radio" name="size" value="M"> M (170–180 cm)</label>
            <input id="box" type="checkbox" name="news" data-footprint="Newsletter opt-in">
        `);

        expect(nameOf($('#email'))).toBe('email');
        expect(nameOf($('#plain'))).toBe('plain');
        expect(nameOf($('#radio'))).toBe('M (170–180 cm)');
        expect(nameOf($('#box'))).toBe('Newsletter opt-in');
    });
});

describe('fieldName', () => {
    it('falls back through name, label, aria-label, id and tag', () => {
        html(`
            <input id="a" data-footprint="Rider height" name="height">
            <input id="b" name="height">
            <label for="c">Your height</label><input id="c">
            <input id="d" aria-label="Height in cm">
            <span id="hl">Height</span><input id="e" aria-labelledby="hl">
            <textarea id="f"></textarea>
            <div><textarea></textarea></div>
        `);

        expect(fieldName($('#a'))).toBe('Rider height');
        expect(fieldName($('#b'))).toBe('height');
        expect(fieldName($('#c'))).toBe('Your height');
        expect(fieldName($('#d'))).toBe('Height in cm');
        expect(fieldName($('#e'))).toBe('Height');
        expect(fieldName($('#f'))).toBe('f');
        expect(fieldName($('div textarea'))).toBe('textarea');
    });
});

describe('formName', () => {
    it('falls back through data-footprint, aria-label, name, id and action path', () => {
        html(`
            <form id="f1" data-footprint="Quote" aria-label="x" name="y"></form>
            <form id="f2" aria-label="Contact form"></form>
            <form id="f3" name="newsletter"></form>
            <form id="f4"></form>
            <form class="f5" action="/quote?step=2"></form>
            <form class="f6" action="/orders/Xk9fQ2LmP0aZ7bR4tY1uW8eV3sD6gH5jN2kL9mQ0"></form>
            <form class="f7"></form>
        `);

        expect(formName($('#f1'))).toBe('Quote');
        expect(formName($('#f2'))).toBe('Contact form');
        expect(formName($('#f3'))).toBe('newsletter');
        expect(formName($('#f4'))).toBe('f4');
        expect(formName($('.f5'))).toBe('/quote');
        expect(formName($('.f6'))).toBe('/orders/{token}');
        expect(formName($('.f7'))).toBeNull();
        expect(formName(null)).toBeNull();
    });
});

describe('deadName', () => {
    it('uses a named ancestor, an image alt, heading text, then the tag', () => {
        html(`
            <div data-footprint="Spec row"><span id="a">Weight</span></div>
            <img id="b" alt="Black Mamba side view" src="x.jpg">
            <picture><source srcset="x.webp"><img id="c" alt="Hornisse" src="x.jpg"></picture>
            <h2><span id="d">Three steps to your bike</span></h2>
            <p id="e">Personal story with jane@example.com</p>
        `);

        expect(deadName($('#a'))).toBe('Spec row');
        expect(deadName($('#b'))).toBe('Black Mamba side view');
        expect(deadName($('picture source'))).toBe('Hornisse');
        expect(deadName($('#d'))).toBe('Three steps to your bike');
        expect(deadName($('#e'))).toBe('p');
    });
});

describe('interactive and ignored', () => {
    it('finds the nearest interactive ancestor', () => {
        html(`
            <a href="/x"><span id="a">x</span></a>
            <div role="button"><i id="b"></i></div>
            <div tabindex="0"><i id="c"></i></div>
            <div onclick="void 0"><i id="d"></i></div>
            <a><span id="e">no href</span></a>
            <div tabindex="-1"><i id="f"></i></div>
        `);

        expect(interactive($('#a'))?.tagName).toBe('A');
        expect(interactive($('#b'))?.getAttribute('role')).toBe('button');
        expect(interactive($('#c'))?.getAttribute('tabindex')).toBe('0');
        expect(interactive($('#d'))).not.toBeNull();
        expect(interactive($('#e'))).toBeNull();
        expect(interactive($('#f'))).toBeNull();
    });

    it('treats a whole subtree as ignored', () => {
        html(`<div data-footprint-ignore><p><button id="a">x</button></p></div><button id="b">y</button>`);

        expect(ignored($('#a'))).toBe(true);
        expect(ignored($('#b'))).toBe(false);
    });
});

describe('sections', () => {
    it('attributes to the innermost marked section or landmark', () => {
        html(`
            <header id="top"><button id="a">Menu</button></header>
            <main>
                <div data-footprint-section="hero"><button id="b">Go</button></div>
                <section id="faq"><button id="c">Q</button></section>
                <p id="d">loose</p>
            </main>
            <dialog aria-label="Geometry"><button id="e">Close</button></dialog>
        `);

        expect(sectionName(sectionOf($('#a'))!)).toBe('top');
        expect(sectionName(sectionOf($('#b'))!)).toBe('hero');
        expect(sectionName(sectionOf($('#c'))!)).toBe('faq');
        expect(sectionOf($('#d'))).toBeNull();
        expect(sectionName(sectionOf($('#e'))!)).toBe('Geometry');
    });

    it('names a section by attribute, id, aria-label, then tag', () => {
        html(`<div id="a" data-footprint-section="">x</div><footer id="b"></footer>`);

        expect(sectionName($('#a'))).toBe('a');
        expect(sectionName(document.createElement('footer'))).toBe('footer');
    });
});
