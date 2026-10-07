# The page view: the live page with layers, and visit playback

The editor sees the real page, not a screenshot: an iframe of the entry's URL at a device's width, with Footprint's numbers drawn over the sections they belong to. The CP and the site share an origin, so the CP can read the iframe's document and draw inside it. Statamic sets no frame-blocking headers on front-end pages; check the web server's own headers (`X-Frame-Options: DENY` or a `frame-ancestors` CSP that excludes the site would block it) and explain in the tab when the frame cannot be read.

## Sizing the frame

| Device | Frame width | Frame height |
|---|---|---|
| mobile | 390 | 844 |
| tablet | 820 | 1180 |
| desktop | 1440 | 900 |

- Render the frame at the device's real width and scale it down with `transform: scale(available / width)` and `transform-origin: 0 0`, wrapping it in a box of the scaled height. Media queries then see the real width, so the layout matches the one the data came from.
- Keep a real viewport height and let the page scroll inside the frame. Do not size the frame to the page's full height: `100vh` and `svh` sections would grow with it and every position would shift.
- Reload the frame when the device changes, and draw only that device's points.
- After the first load, watch for the frame navigating elsewhere (an editor clicked a link inside it). When `contentWindow.location.pathname` no longer matches, hide the layers and offer a way back.

## Finding the sections

Points are stored against a section's name, so the overlay finds the same elements the tracker named. Mirror the tracker's rules: every `[data-footprint-section]`, plus `header`, `footer`, `section[id]` and `dialog` that neither contain nor sit inside a marked section. The name is the attribute, else the `id`, else `aria-label`, else the tag name.

```js
// resources/js/cp/interactions/sections.js
const LANDMARKS = 'header, footer, section[id], dialog';

export function sectionsIn(doc) {
    const marked = [...doc.querySelectorAll('[data-footprint-section]')];
    const landmarks = [...doc.querySelectorAll(LANDMARKS)].filter(
        (element) => !element.closest('[data-footprint-section]') && !element.querySelector('[data-footprint-section]'),
    );

    const byName = new Map();

    for (const element of [...marked, ...landmarks].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))) {
        const name = element.getAttribute('data-footprint-section') || element.id || element.getAttribute('aria-label') || element.tagName.toLowerCase();

        if (!byName.has(name)) byName.set(name, element);
    }

    return byName;
}

// Pages that render on the client (Inertia, Livewire, Turbo) add their
// sections after the load event.
export async function waitForSections(doc, timeout = 4000) {
    const until = performance.now() + timeout;

    while (performance.now() < until && !doc.querySelector('[data-footprint-section]')) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}
```

- The tracker stores names after collapsing whitespace, cutting them to 100 characters and replacing runs of five or more digits. Short kebab-case names match exactly.
- Only the first element with a name gets points. Two sections sharing a name share their data; the fix belongs on the page (`faq`, `faq-2`), not in the overlay.
- A section in the data with no element here was renamed or removed. List it, do not draw it.

## Drawing the layers

Draw into one root element inside the frame's document, positioned in document coordinates, so the layers scroll with the page. Mark the root `data-footprint-ignore` so nothing about it could ever be recorded, and remove it when the tab unmounts or a layer is switched off.

```js
// resources/js/cp/interactions/overlay.js
const RADIUS = 28;

export function clearOverlay(doc) {
    doc.querySelector('[data-footprint-overlay]')?.remove();
}

export function drawOverlay(doc, sections, { rows, points, layers }) {
    clearOverlay(doc);

    const win = doc.defaultView;
    const root = doc.createElement('div');
    root.setAttribute('data-footprint-overlay', '');
    root.setAttribute('data-footprint-ignore', '');
    Object.assign(root.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: '2147483647' });
    doc.documentElement.appendChild(root);

    for (const row of rows) {
        const element = sections.get(row.section);

        if (!element) continue;

        const box = element.getBoundingClientRect();
        const frame = doc.createElement('div');
        Object.assign(frame.style, {
            position: 'absolute',
            left: `${box.left + win.scrollX}px`,
            top: `${box.top + win.scrollY}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
        });
        root.appendChild(frame);

        if (layers.attention) attention(doc, frame, row);
        if (layers.clicks) heat(doc, frame, box, points.filter((point) => point.section === row.section && point.type === 'click'));
        if (layers.frustration) markers(doc, frame, box, points.filter((point) => point.section === row.section && point.type !== 'click'));
    }
}

function attention(doc, frame, row) {
    frame.style.background = `rgba(37, 99, 235, ${0.08 + 0.32 * (1 - row.reach)})`;
    frame.style.outline = '1px solid rgba(37, 99, 235, 0.5)';

    const label = doc.createElement('div');
    label.textContent = `${Math.round(row.reach * 100)}% reached · ${Math.round(row.median_ms / 1000)} s`;
    Object.assign(label.style, { position: 'absolute', left: '8px', top: '8px', padding: '2px 8px', borderRadius: '6px', font: '600 12px/1.5 system-ui, sans-serif', color: '#fff', background: 'rgba(15, 23, 42, 0.85)' });
    frame.appendChild(label);
}

function heat(doc, frame, box, points) {
    if (points.length === 0) return;

    const ratio = doc.defaultView.devicePixelRatio || 1;
    const canvas = doc.createElement('canvas');
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });

    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);

    // Pass one: stack soft alpha blobs, so density becomes alpha.
    for (const point of points) {
        const x = point.x * box.width;
        const y = point.y * box.height;
        const gradient = context.createRadialGradient(x, y, 0, x, y, RADIUS);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;
        context.fillRect(x - RADIUS, y - RADIUS, RADIUS * 2, RADIUS * 2);
    }

    // Pass two: map alpha onto a sequential ramp.
    const image = context.getImageData(0, 0, canvas.width, canvas.height);

    for (let i = 3; i < image.data.length; i += 4) {
        const density = image.data[i] / 255;

        if (density === 0) continue;

        const [r, g, b] = ramp(density);
        image.data[i - 3] = r;
        image.data[i - 2] = g;
        image.data[i - 1] = b;
        image.data[i] = Math.min(210, 60 + density * 300);
    }

    context.putImageData(image, 0, 0);
    frame.appendChild(canvas);
}

// Low density cool, high density hot. Swap for the app's own ramp.
function ramp(t) {
    const stops = [[59, 130, 246], [16, 185, 129], [250, 204, 21], [239, 68, 68]];
    const scaled = Math.min(0.999, t) * (stops.length - 1);
    const [a, b] = [stops[Math.floor(scaled)], stops[Math.floor(scaled) + 1]];
    const f = scaled - Math.floor(scaled);

    return a.map((value, index) => Math.round(value + (b[index] - value) * f));
}

function markers(doc, frame, box, points) {
    for (const point of points) {
        const marker = doc.createElement('div');
        marker.title = `${point.type === 'rage' ? 'Rage click' : 'Dead click'}: ${point.target}`;
        Object.assign(marker.style, {
            position: 'absolute',
            left: `${point.x * box.width - 7}px`,
            top: `${point.y * box.height - 7}px`,
            width: '14px',
            height: '14px',
            borderRadius: point.type === 'rage' ? '50%' : '2px',
            border: `2px solid ${point.type === 'rage' ? '#dc2626' : '#6b7280'}`,
            background: 'rgba(255, 255, 255, 0.6)',
        });
        frame.appendChild(marker);
    }
}
```

Redraw when the layout moves: on the frame's `load`, after `waitForSections`, on `doc.fonts.ready`, and from a `ResizeObserver` created from the frame's window (`new doc.defaultView.ResizeObserver(...)`) watching `doc.documentElement`, throttled to one draw per animation frame.

Pair the picture with a legend: what a tint and a hot spot mean, the device and range shown, and how many points were drawn ("1,240 clicks from 3,016 desktop views"). Hovering or focusing a row in the lists can outline its section in the frame; the lists stay the accessible source of every number.

## Visit playback

`visits` lists recent visits to the page; `visit` returns one visit's events (dwell rows excluded, they are accounting, not actions). The player replays the events of this page's views over the frame.

```js
// resources/js/cp/interactions/timeline.js
const LONGEST_PAUSE = 2500;

export function timeline(events, path) {
    const views = new Set(events.filter((event) => event.type === 'view' && event.path === path).map((event) => event.view));
    let clock = 0;
    let last = null;

    return events
        .filter((event) => views.has(event.view))
        .map((event) => {
            if (last !== null) clock += Math.min(Math.max(0, event.t - last), LONGEST_PAUSE);
            last = event.t;

            return { at: clock, event };
        });
}

// The view that came after this page's last view, for the closing card.
export function exit(events, path) {
    const last = Math.max(...events.filter((event) => event.type === 'view' && event.path === path).map((event) => event.view));

    return events.find((event) => event.type === 'view' && event.view === last + 1)?.path ?? null;
}
```

Play it with a `requestAnimationFrame` loop that advances a clock by elapsed time times the speed (1×, 2×, 4×) and runs every step whose `at` has passed. Pauses are capped at 2.5 seconds, so a visit that idled still plays in a minute. Give it play, pause, the speed and a scrubber that re-runs steps from the start up to the chosen point.

| Event | What the player shows |
|---|---|
| `view` | Frame to the top, a card with where the visit came from: `previous`, else the visit's referrer host, else "direct". |
| `section` | Scroll the section into view, smoothly. |
| `scroll` | Scroll so the bottom of the viewport sits at that share of the page: `top = value / 100 × scrollHeight − innerHeight`. |
| `click` | A pulse at `x`, `y` inside the section, with the target's name beside it. |
| `rage` | A red ripple, three rings. |
| `dead` | A grey cross that fades. |
| `field` | An outline on the field found by `[name="…"]`, `[data-footprint="…"]` or its label text; `CSS.escape` the name. |
| `submit` | A green tick on the form. |
| `abandon` | A red "left here" badge on the field. |
| `custom` | A small toast with the event's name. |

- Set the frame to the visit's own viewport width (its `viewport`, clamped to 320–1920) before playing, so positions land where they were.
- Close with the visit's exit: the next path it went to, or "left the site".
- Keep the label *Reconstructed from recorded events, not a screen recording* on the player at all times. Footprint stores what happened, never what the screen looked like, and the page may have changed since.
- Show a visit by its device, width, length, language and referrer host. Never show its id, and never offer to look anything up about who it was.
