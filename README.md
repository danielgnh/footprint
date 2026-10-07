# Footprint

Anonymous UI interaction analytics for Laravel. Footprint records what people do on a page — which sections they reach and how long they look at them, how far they scroll, what they click and where, which clicks go nowhere, which form fields they touch and where they give up — and nothing that ties any of it to a person.

It is a plain Laravel package, so it works under any CMS or front end built on Laravel: Statamic, Filament, Inertia, Livewire or plain Blade.

> Status: the core. The tracker, the ingest endpoint and the storage are built and tested; reports come next.

## Install

```bash
composer require danielgnh/footprint
php artisan migrate
```

Put the tag in the `<head>` of your layout, before your own scripts:

```blade
@footprint
```

It renders a one-line stub, so `window.footprint.track()` works before the tracker has loaded, and the deferred tracker itself (about 5.7 kB gzipped).

Templates that are not Blade print the same markup from PHP: `app(\Danielgnh\Footprint\Script::class)->tag()`. Statamic's Antlers, for example, can call it from a small tag or a view composer.

## Marking up a page

The tracker works without any markup: it treats `header`, `footer`, `section[id]` and `dialog` as sections and names clicks from their accessible names. Three attributes make the data sharper:

| Attribute | Effect |
|---|---|
| `data-footprint-section="hero"` | Marks a section and names it. Reach and dwell are counted per section; clicks are placed inside it. |
| `data-footprint="Hero CTA"` | Names an element for clicks, fields or forms, ahead of anything it would read off the element. |
| `data-footprint-ignore` | Nothing inside this element is recorded: no clicks, fields, sections or rage clicks. Put it on anything that can show personal data, such as an account menu. |

Custom milestones go through `track`:

```js
window.footprint.track('configurator_option', { part: 'wheels', handle: 'irondeer-gravel-50' });
```

A name is 1–60 characters of `A-Z a-z 0-9 _ . : -`. Up to ten props are kept; keys follow the same pattern up to 40 characters, values are strings (scrubbed, cut to 100), numbers, booleans or null.

## Configuration

`php artisan vendor:publish --tag=footprint-config` publishes `config/footprint.php`.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` (`FOOTPRINT_ENABLED`) | Off removes the tag's output and the routes. |
| `connection` | default (`FOOTPRINT_DB_CONNECTION`) | Database connection for the two tables. |
| `endpoint` | `/footprint/events` | Where batches are posted. |
| `script` | `/footprint/footprint.js` | Where the tracker is served from. |
| `sample_rate` | `1.0` (`FOOTPRINT_SAMPLE_RATE`) | Share of page loads that record anything. |
| `respect_gpc` | `true` | Record nothing for a browser sending Global Privacy Control or Do Not Track. |
| `allowed_hosts` | `[]` | Hosts besides the endpoint's own and the app URL's that may post. |
| `redact_routes` | `[]` | Route name patterns stored as their URI, e.g. `['*.orders.show']` stores `/orders/{order}`. |
| `rate_limit` | `120` | Batches per minute per IP address. |

## What is collected

### Privacy, by construction

- **No identity.** A visit is a random UUID held in the page's memory. Nothing is written to cookies, localStorage or sessionStorage, so a reload is a new visit and two visits are never linked. On a single-page app a visit spans every client-side navigation of one page load.
- **No values.** The tracker never reads what is typed into a field, selected in a select or written in a contenteditable. It never reads text from non-interactive elements, except the `alt` or heading text that names a dead click.
- **Scrubbed names.** Every name it does read is collapsed to single spaces, has emails replaced by `{email}` and runs of five or more digits (phone, card, IBAN, order numbers) replaced by `{n}`, and is cut to 60 characters. The server scrubs again.
- **Paths without secrets.** Query strings and fragments are dropped. A path segment that looks like a secret becomes `{token}`: a UUID, anything with `@`, or a part of 16+ characters mixing letters and digits (Laravel's `Str::random`, hashes, JWTs). Routes in `redact_routes` are stored as their URI.
- **Referrers as hosts.** An external referrer is kept as its host only; a same-origin one as its normalised path. Links are stored as a path (internal), a host (external) or a bare `mailto:`, `tel:`, `sms:`.
- **Campaign tags only.** Of the landing URL's query, only `utm_source`, `utm_medium`, `utm_campaign` and `utm_content` are kept.
- **Nothing about the device but its class.** Viewport width is rounded down to 50 px; the device is `mobile` (under 768 px), `tablet` (coarse pointer) or `desktop`.
- **Nothing about the connection.** The server never stores the IP address, the user agent or a full URL. The IP is hashed with the app key into a rate-limit key that expires within a minute; the user agent is only matched against a bot list. The endpoint sits outside the `web` middleware group: no session is started and no cookie is read or set.
- **Opt-outs honoured.** Global Privacy Control, Do Not Track and automated browsers (`navigator.webdriver`) record nothing.

Mention the collection in your privacy policy. Whether it needs consent where you operate is for you and your advisers to decide; the design aims to need none.

### Tables

`footprint_visits`, one row per visit (the `Visit` model):

| Column | Meaning |
|---|---|
| `id` | Random UUID from the browser's memory. |
| `host` | Host of the page, from the batch's `Origin` or `Referer`. A site posting through `allowed_hosts` keeps its own host. |
| `entry_path` | Normalised path of the first view. |
| `referrer_host` | Host of an external referrer, or null. |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` | Campaign tags from the landing URL, scrubbed. |
| `device` | `mobile`, `tablet` or `desktop`. |
| `viewport` | Viewport width, rounded down to 50 px. |
| `lang` | The page's `<html lang>`. |
| `views`, `events` | Counts so far. |
| `started_at`, `ended_at` | Server time of the first and the latest batch. |

`footprints`, one row per event (the `Footprint` model):

| Column | Meaning |
|---|---|
| `visit_id`, `view` | The visit, and which view within it (1, 2, … per path change). |
| `t` | Milliseconds since the visit started, for ordering. |
| `host`, `path` | Where it happened. |
| `type` | One of the event types below. |
| `section`, `section_index` | Section name; for `section`, its position on the page. |
| `target` | Element, field or custom event name. |
| `href` | Where a clicked link points. |
| `previous` | For a `view`, the path before it. |
| `form` | Form name for field events. |
| `x`, `y` | Click position inside its section, 0–1 (page-relative outside any section; null for keyboard activation). |
| `value` | Milliseconds for `dwell`, percent for `scroll`. |
| `data` | Props of a custom event. |
| `created_at` | Server time the batch arrived. |

### Event types

| Type | Sent when | Columns used |
|---|---|---|
| `view` | A page loads, a path changes through `pushState`/`replaceState`/`popstate`, or a page returns from the back-forward cache. A query-only change is not a view. | `previous` |
| `section` | A section is first seen in a view: half of it is visible, or it fills half the viewport. | `section`, `section_index` |
| `dwell` | On every flush, the milliseconds a section was seen since the last one, while the tab was visible and the visitor active in the last 30 s. `section` null is time on the page. Sum them per view. | `section`, `value` |
| `scroll` | The deepest point reached passes another 10%. A page shorter than the viewport reports 100. | `value` |
| `click` | An interactive element is clicked: a link, button, form control, label, summary, ARIA widget, `[tabindex="0"]`, `[onclick]` or `[data-footprint]`. A label's click on its own control is counted once. | `target`, `href`, `section`, `x`, `y` |
| `rage` | A third press within 700 ms and 24 px of the first, disabled buttons included. Not when it selected text. | `target`, `section`, `x`, `y` |
| `dead` | A click on something non-interactive that changed nothing within a second: no DOM change, navigation, scroll or text selection. Any DOM change cancels it, so animated pages under-report. | `target`, `section`, `x`, `y` |
| `field` | Focus moves to a field other than the last one focused. | `target`, `form` |
| `submit` | A form is submitted. | `form` |
| `abandon` | A view ends while a form has been touched since its last submit; `target` is the last field focused. A tab killed by the OS sends none, so also read the last `field` of views without a `submit`. | `target`, `form` |
| `custom` | `footprint.track(name, props)`. | `target`, `data` |

### Delivery

Events wait in memory and go out as one `text/plain` JSON batch through `navigator.sendBeacon`, falling back to a `keepalive` fetch without credentials. A batch is sent when the tab is hidden or the page unloads, every 15 seconds, and once 50 events have built up. A refused send keeps the events for the next trigger; nothing retries in a loop, and the buffer holds at most 1,000 events. Because dwell is sent as deltas, a tab that is killed outright loses at most 15 seconds of it.

The wire format is `contract/batch.schema.json`. The server rejects a malformed envelope with 422 and drops a single event it cannot read, so a newer tracker never loses the rest of its batch.

## Querying

Both models have query methods that read the data the way it was written, so the rest is plain Eloquent:

```php
use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;

$page = Footprint::onPage('https://example.com/pricing')
    ->between(now()->subDays(30), now())
    ->onDevice('mobile');

$views = $page->clone()->ofType('view')->count();
$medianTime = $page->clone()->dwellPerView()->get()->whereNull('section')->median('ms');
$readToTheEnd = $page->clone()->deepestScroll()->get()->where('depth', 100)->count() / max(1, $views);
$deadClicks = $page->clone()->ofType('dead')->inSection('hero')->selectRaw('target, count(*) as clicks')->groupBy('target')->get();

$gaveUp = Visit::whereHas('footprints', fn ($footprints) => $footprints->onPage('/quote')->ofType('abandon')->where('target', 'email'));
$events = $visit->footprints()->timeline()->get();
```

| Method | On | What it does |
|---|---|---|
| `onPage($url)` | `Footprint` | Rows of a page. Takes a full URL or a path and normalises it the way ingest stored it; a URL with a host also matches the host. |
| `landedOn($url)` | `Visit` | Visits that started on a page, matched the same way. |
| `onHost($host)` | both | Rows of one host. |
| `between($from, $to)` | both | Rows that arrived (`Footprint`) or visits that started (`Visit`) from `$from` up to, not including, `$to`. |
| `onDevice($device)` | both | `mobile`, `tablet` or `desktop`. |
| `ofType(...$types)`, `inSection($section)` | `Footprint` | Event types and the section they happened in. |
| `dwellPerView()` | `Footprint` | One row per view and section with `ms`, the time it was on screen. A null section is time on the page. |
| `deepestScroll()` | `Footprint` | One row per view with `depth`, the deepest scroll in percent. A view without a row never passed 10%. |
| `reachedSections()` | `Footprint` | One row per view and section it reached, with `position` on the page. A section's reach is its row count divided by the page's views. |
| `timeline()` | `Footprint` | Events in the order they happened, without `dwell`. |

`dwell` and `scroll` rows are deltas and new maxima. Summing, averaging or counting them raw gives wrong numbers, so go through `dwellPerView()` and `deepestScroll()`.

## AI agents (Laravel Boost)

Footprint ships [Laravel Boost](https://github.com/laravel/boost) content in `resources/boost/`. Running `php artisan boost:install` in an app that requires the package picks it up:

- **Guideline**, always loaded: how to mark up pages, what never to send, and how to read the tables correctly (dwell is a delta, positions belong to one device).
- **`footprint-statamic-interactions`** skill: building an Interactions tab on Statamic 6 entries. It covers figures, a section funnel, a click and frustration map drawn over the live page in an iframe, form drop-off, and visit playback reconstructed from events. The tests run the skill's query class and overlay modules against recorded browser data, so the documented code keeps working.

## Development

```bash
composer install && npm install
composer test                      # rector, pint, phpstan, pest
npm run typecheck && npm test      # tsc + vitest
npm run build                      # tracker into resources/dist, with the 6 kB budget
npx playwright test                # Chromium, WebKit, iPhone, Pixel, plus a full-stack run on testbench
RECORD=1 npx playwright test       # also writes what each browser sent to contract/fixtures
```

`contract/cases/*.json` hold the scrub and path vectors both sides run, so the tracker and the server cannot drift apart. Pest replays every recorded batch in `contract/fixtures` through the real endpoint.
