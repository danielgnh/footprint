---
name: footprint-statamic-interactions
description: Build an "Interactions" tab on Statamic v6 entry edit pages that shows how visitors use the entry's page, from danielgnh/footprint data — figures, a section funnel, a click and frustration map drawn over the live page in an iframe, form drop-off, and visit playback reconstructed from events. Use when someone wants Footprint data in the Statamic control panel.
---

# Footprint: an Interactions tab on Statamic entries

## When to use this skill

Use it when the developer wants editors to see, inside the Statamic control panel, how visitors use a page: which sections they reach and how long they stay, what they click, where they get stuck, which form fields they give up on. The tab lives on the entry edit page, so an editor reads it next to the content they are changing.

Footprint ships the data, not the panel. Everything below is built in the host app. It targets Statamic 6 (Vue 3 control panel, `@statamic/cms` package) and Footprint's tables as described in the package README.

## What the editor gets

Build these in this order; each step is useful on its own.

1. **Figures** for the entry's URL over a date range (7, 30, 90 days) and a device (mobile, tablet, desktop, all): views, visits, median time on page, the share that scrolled past half and to the end, rage clicks, dead clicks, abandoned forms.
2. **Section funnel**: every section in page order with the share of views that reached it and the median time it stayed on screen. This answers "do people get to the part that sells" before any picture does.
3. **The page itself**: the live page in an iframe at the chosen device's width, with layers the editor switches on: *Attention* (each section tinted by reach, labelled with reach and median time), *Clicks* (a heat layer of click points inside each section), *Frustration* (rage and dead click markers).
4. **Lists** that carry the same numbers for anyone who cannot read the picture: top clicked elements with the share of visits that clicked them, frustration hotspots, each form's fields with focus and abandon counts, where visitors came from and went next.
5. **Visit playback**: recent visits to the page; pick one and watch its events replayed over the page — scrolling to each section as it was reached, a pulse at each click, a red ripple for rage, the field it was abandoned on. Label it *reconstructed from recorded events*: Footprint records no screen and no DOM, and the UI must never suggest otherwise.

## Architecture

| Piece | Where | Job |
|---|---|---|
| Query class | `app/Footprint/PageInteractions.php` | Every number for one page URL, range and device, built on the query methods of Footprint's models. Plain arrays, unit-testable. See `references/queries.md`. |
| CP controller | `app/Http/Controllers/CP/InteractionsController.php` | JSON for the tab: `summary`, `visits`, `visit`. Authorizes, validates, caches. |
| Fieldtype | `app/Fieldtypes/Interactions.php` | Display-only field. `preload()` hands the Vue side the entry's URL, its normalised path for playback and the endpoint URLs. |
| Listener | `app/Listeners/AddInteractionsTab.php` | Adds the field in an `interactions` tab on `EntryBlueprintFound`. |
| Provider | `AppServiceProvider::boot()` | Permission, CP routes, CP Vite entry. |
| Vue | `resources/js/cp.js`, `resources/js/cp/*` | The tab: filters, figures, lists, the page view with its layers, the player. See `references/page-view.md`. |

## Step 1: keep the control panel from recording itself

The tab loads the live page in an iframe on the same domain, and editors open pages in Live Preview. Both must not record. Render the tracker for guests only:

```blade
@guest
    @footprint
@endguest
```

Statamic's CP signs editors in on the `web` guard by default, so an editor is never a guest on the front end and the iframe carries no tracker. If the app gives the CP its own guard, test `\Statamic\Facades\User::current()` instead. Check this before building anything else; otherwise every editor visit to the tab writes rows about the page being inspected.

## Step 2: the tab

```php
namespace App\Listeners;

use Statamic\Events\EntryBlueprintFound;
use Statamic\Statamic;

class AddInteractionsTab
{
    public function handle(EntryBlueprintFound $event): void
    {
        if (! $event->entry || ! Statamic::isCpRoute()) {
            return;
        }

        if (! in_array($event->entry->collectionHandle(), config('interactions.collections', ['pages']), true)) {
            return;
        }

        $event->blueprint->ensureFieldInTab('interactions', [
            'type' => 'interactions',
            'visibility' => 'computed',
            'listable' => false,
            'hide_display' => true,
        ], 'interactions');
    }
}
```

- `EntryBlueprintFound` fires with `entry = null` in the blueprint builder, on the create page and in GraphQL. Returning early there keeps the field out of the builder, so saving a blueprint never writes it into the YAML.
- `Statamic::isCpRoute()` keeps the field off the front end, where `Entry::blueprint()` fires the same event while rendering.
- `visibility: computed` is what keeps the field's value out of the saved entry: Statamic drops computed fields from the values it saves. There is no `save: false`.
- The tab handle `interactions` displays as "Interactions". `ensureFieldInTab` creates the tab when it is missing and ignores a second call for the same handle.
- List only collections whose entries have front-end URLs. Laravel discovers the listener from its typed `handle()`. If event discovery is off, register it with `Event::listen`.

## Step 3: the fieldtype

```php
namespace App\Fieldtypes;

use Danielgnh\Footprint\Ingest\PathNormalizer;
use Statamic\Contracts\Entries\Entry;
use Statamic\Facades\User;
use Statamic\Fields\Fieldtype;

class Interactions extends Fieldtype
{
    protected $selectable = false;

    public function preload(): array
    {
        $entry = $this->field()?->parent();

        if (! $entry instanceof Entry || blank($entry->url()) || ! User::current()?->can('view interactions')) {
            return ['available' => false];
        }

        return [
            'available' => true,
            'url' => $entry->absoluteUrl(),
            'path' => app(PathNormalizer::class)->normalize(parse_url($entry->absoluteUrl(), PHP_URL_PATH) ?? '/'),
            'published' => $entry->published(),
            'edited' => $entry->lastModified()?->toIso8601String(),
            'endpoints' => [
                'summary' => cp_route('interactions.summary'),
                'visits' => cp_route('interactions.visits'),
                'visit' => cp_route('interactions.visit', ['visit' => '__visit__']),
            ],
        ];
    }

    public function process($data)
    {
        return null;
    }
}
```

- A `Fieldtype` under `app/Fieldtypes` registers itself. The class `Interactions` gets the handle `interactions`, and the Vue component is registered as `interactions-fieldtype`.
- On the edit page `$this->field()->parent()` is the entry, the working copy; on the create page it is the collection, hence the `instanceof` check.
- `preload()` runs again on every save, so it must stay cheap: URLs only, no queries. The Vue side fetches the numbers.
- Editing a localization opens that localization's entry, so `absoluteUrl()` is already the `/pt/...` URL and the tab shows that language's visitors. Summing all languages is an option: run the query class for each localization's URL and add up the counts.
- When the front end serves the entry at a URL other than `$entry->url()` (custom Laravel routes), map it here; the URL must be the one visitors load.

## Step 4: permission, routes and assets

```php
use App\Http\Controllers\CP\InteractionsController;
use Illuminate\Support\Facades\Route;
use Statamic\Facades\Permission;
use Statamic\Statamic;

public function boot(): void
{
    Permission::extend(function () {
        Permission::register('view interactions')->label('View page interactions');
    });

    Statamic::pushCpRoutes(function () {
        Route::prefix('interactions')->name('interactions.')->group(function () {
            Route::get('summary', [InteractionsController::class, 'summary'])->name('summary');
            Route::get('visits', [InteractionsController::class, 'visits'])->name('visits');
            Route::get('visits/{visit}', [InteractionsController::class, 'visit'])->name('visit');
        });
    });

    Statamic::vite('app', [
        'input' => ['resources/js/cp.js', 'resources/css/cp.css'],
        'hotFile' => public_path('cp-hot'),
        'buildDirectory' => 'vendor/app',
    ]);
}
```

- `pushCpRoutes` mounts the routes under the CP prefix and its authenticated middleware, named `statamic.cp.interactions.*`; `cp_route('interactions.summary')` finds them.
- `php please statamic:setup-cp-vite` scaffolds the CP build: `vite-cp.config.js` with `@statamic/cms/vite-plugin`, `resources/js/cp.js`, `resources/css/cp.css`, the `cp:dev` and `cp:build` scripts, and the `Statamic::vite` call above. Keep it separate from the front-end Vite config.

The controller extends `Statamic\Http\Controllers\CP\CpController`, calls `$this->authorize('view interactions')` in every action and validates its input: `url` (the entry's full URL, which `onPage()` normalises), `days` in 7, 30 and 90, and `device` in mobile, tablet and desktop. It caches each answer for ten minutes under a key built from those inputs, and returns arrays. `summary` returns figures, sections, scroll depth, clicks, frustration, forms, flows and, only when a device is chosen, the click points. `visits` lists recent visits to the page. `visit` returns one visit's events in order. The queries are in `references/queries.md`.

## Step 5: the Vue side

```js
// resources/js/cp.js
import InteractionsFieldtype from './cp/InteractionsFieldtype.vue';

Statamic.booting(() => {
    Statamic.$components.register('interactions-fieldtype', InteractionsFieldtype);
});
```

```vue
<script setup>
import { Fieldtype } from '@statamic/cms';
import { getCurrentInstance, onMounted, ref, watch } from 'vue';

const emit = defineEmits(Fieldtype.emits);
const props = defineProps(Fieldtype.props);
const { expose } = Fieldtype.use(emit, props);
defineExpose(expose);

const axios = getCurrentInstance().appContext.config.globalProperties.$axios;
const root = ref(null);
const days = ref(30);
const device = ref('desktop');
const report = ref(null);

async function load() {
    report.value = null;
    const { data } = await axios.get(props.meta.endpoints.summary, {
        params: { url: props.meta.url, days: days.value, device: device.value },
    });
    report.value = data;
}

onMounted(() => {
    if (!props.meta.available) return;
    // The tab may mount hidden: fetch and load the page only once it is shown.
    const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
            observer.disconnect();
            load();
        }
    });
    observer.observe(root.value);
});

watch([days, device], () => report.value && load());
</script>
```

Compose the tab from `@statamic/cms/ui`: `Panel` and `Card` for the blocks, `Heading`, `Description`, `Badge`, `Select` or `ToggleGroup` for the range and device, `Tabs` for the layer switch, `Table` for the lists and `Skeleton` while loading. Check each component's props in the package's `types/components/ui` before use. The page view with its layers and the player is in `references/page-view.md`.

## Reading the data correctly

- Query a page with `Footprint::onPage($url)` and the entry's full URL: it normalises the path the way ingest stored it and matches the host, so sites on different domains stay apart. Rows outside the date range or the chosen device are excluded at the query, never in Vue.
- `dwell` rows are deltas and `scroll` rows new maxima, so never sum or count them raw. Take medians of `dwellPerView()`'s `ms` (`section: null` is time on the page) and shares of `deepestScroll()`'s `depth`. A view with no `scroll` row never passed 10%.
- Reach of a section is its `reachedSections()` rows divided by the views of the page.
- `x` and `y` are 0–1 inside the section, so click positions are only true on the layout they came from. Draw points for one device at a time, in an iframe at that device's width. With no device chosen, show the lists and figures, not the map.
- Sections are matched to the live page by name. A name in the data with no element on the page is a section that was renamed or removed: list it as no longer on the page and leave it off the map.
- The page in the iframe is today's page; the data may be older. Show when the entry was last edited, and offer to start the range there when it falls inside it.
- Below roughly 30 views, show counts rather than percentages and say the sample is small. Never present a pattern from a handful of visits as a finding.

## Rules

- Never join Footprint data with anything that identifies a person: users, form submissions, orders, logs with IPs. A visit is shown as its device, viewport, length and referrer host, never by its id.
- The tab only reads. It never writes to Footprint's tables and never records the editor's own use.
- Cache every query result. Cap click points at a few thousand, newest first, and keep the default range at 30 days.
- Playback is labelled as reconstructed from recorded events, everywhere it appears.
- The lists carry every number the picture shows, so the tab works without seeing the overlay.

## Testing

- Seed data the way production gets it: post batches to the package's ingest endpoint in a feature test, with an `Origin` matching the app URL and a browser user agent (bots are dropped). The package's `contract/fixtures/` holds real browser batches to start from.
- Unit-test `PageInteractions` against that data: reach, median dwell, scroll shares, click shares, form abandons, flows, and that a device filter changes them.
- Feature-test the controller: 403 without `view interactions`, validation errors, the JSON shape.
- Assert the listener adds the field on an entry edit and nowhere else: not in the blueprint builder, not on the create page, not on the front end. Assert that saving the entry stores no `interactions` value.
- In a browser, open an entry, switch to the tab, and check that the iframe loads, the overlay draws over the right sections, and no new Footprint rows were written by the visit.
