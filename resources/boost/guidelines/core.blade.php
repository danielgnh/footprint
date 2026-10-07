@verbatim
## Footprint

This app records anonymous UI interactions with `danielgnh/footprint`: page views, which sections are reached and how long they stay on screen, scroll depth, clicks with their position inside the section, rage and dead clicks, form fields touched and abandoned, and custom events. Nothing it stores identifies a person: the visit id lives only in the page's memory, field values are never read, and the server keeps no IP address, user agent or full URL.

### Instrumenting pages

- `@footprint` goes in the `<head>` of the front-end layout. Render it for guests only and never in a CMS preview, so editors and preview frames do not record themselves: `@guest @footprint @endguest`. Templates that are not Blade print `app(\Danielgnh\Footprint\Script::class)->tag()`.
- Give every top-level section of a page a stable, unique `data-footprint-section` name: the block or component handle in kebab case (`hero`, `bike-showcase`, `faq`), never translated copy or a position. Reports compare sections across releases and languages by this name. Repeat a handle on one page as `faq-2`.
- Put `data-footprint="Name"` on a control whose visible text is translated, dynamic or missing (icon buttons), so it reads the same in every language.
- Put `data-footprint-ignore` on anything that can show personal data: account menus, order details, chat widgets. Nothing inside it is recorded.
- Domain milestones go through `window.footprint.track('configurator_option', { part: 'wheels', handle: 'g50' })`. Names are 1–60 characters of `A-Za-z0-9_.:-`; props are flat, at most ten. Never put anything a visitor typed, an email, a name or an id from the database in a prop.

### Reading the data

- Tables: `footprint_visits` (`Danielgnh\Footprint\Models\Visit`, one per page load) and `footprints` (`Danielgnh\Footprint\Models\Footprint`, one per event, `visit_id` + `view` group a page view). The package README is the data dictionary.
- Query through the models' methods, which read the data the way it was written: `Footprint::onPage($url)->between($from, $to)->onDevice('mobile')->ofType('click')->inSection('hero')`, and `Visit::landedOn($url)`. `onPage()` takes a full URL or a path and normalises it as ingest did; never build the path by hand.
- Never sum, average or count raw `dwell` or `scroll` rows: they are deltas and new maxima. `dwellPerView()` gives `ms` per view and section (a null `section` is time on the page); take medians of those. `deepestScroll()` gives `depth` per view.
- Reach of a section is its `reachedSections()` rows divided by the page's `ofType('view')` count.
- Give every view one vote: count `perView()` rows, not raw events. `Footprint::onPage($url)->ofType('rage')->perView('target')` is one row per view and element, so a view with 300 rage clicks counts once.
- `$visit->footprints()->timeline()` gives a visit's events in order, without `dwell`.
- `x` and `y` are 0–1 inside the clicked element's section, so they only make sense on the layout they came from: filter positional data by `footprint_visits.device` and draw it at that device's width.
- Never join footprint data with anything that identifies a person: users, form submissions, orders, logs with IPs.

### Rules

- The ingest route sits outside the `web` middleware group on purpose. Do not add session, cookie or CSRF middleware to it.
- Do not change what the tracker sends from the app; the wire format is the package's `contract/batch.schema.json`.
- Building a Statamic control panel view of this data (an Interactions tab on entries, a click map over the live page, visit playback): use the `footprint-statamic-interactions` skill.
- Giving AI agents this data through the site's Statamic MCP server (`danielgnh/statamic-mcp`), so they can find pages that underperform, see why and measure a change: use the `footprint-statamic-mcp` skill.
@endverbatim
