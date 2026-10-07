---
name: footprint-statamic-mcp
description: Add danielgnh/footprint tools to a Statamic site's MCP server (danielgnh/statamic-mcp), so an AI agent can find the pages that underperform, see why from how visitors use them, change them through the entries tools, and measure the change. Use when someone wants Footprint data in Claude, ChatGPT or another MCP client, or wants agents to research and improve pages from visitor behaviour.
---

# Footprint: interaction tools for the Statamic MCP server

## When to use this skill

Use it when the site runs `danielgnh/statamic-mcp` and `danielgnh/footprint`, and the developer wants agents to work with how visitors use the pages, not only with what is on them. The addon already lets an agent read and edit entries. These tools add the evidence: which pages lose people, where, and whether a change helped.

For an Interactions tab inside the Control Panel, use the `footprint-statamic-interactions` skill. Both share one query class, so build either first.

## The loop the tools serve

| Step | The agent asks | Tool |
|---|---|---|
| Find | Which pages need work? | `interactions_overview` |
| Diagnose | Why does this page lose people? | `interactions_get` |
| Understand | What did visitors actually do? | `interactions_visits` |
| Change | | the addon's `blueprints_get`, `entries_get`, `entries_update`, `entries_preview` |
| Measure | Did the change work? | `interactions_compare` |

The `improve_page` prompt walks an agent through the whole loop; clients like Claude Code offer it as a slash command.

Two things join the steps. Every answer names the page's entry (id, title, collection, `cp_edit_url`), so the agent goes from a number to `entries_update` without a lookup. And every section in `interactions_get` carries its `block`, the page builder set it renders from, so "half of mobile views never reach pricing" becomes "move `page_builder.4` above `page_builder.2`".

## Two readers

You read this skill and build the tools. The agent that uses them reads only the tool descriptions and the answers: it has never seen this skill, the Footprint README or the Boost guideline. So everything it needs to read the numbers lives in the descriptions (what reach is, what a dead click is, that shares run from 0 to 1) and in the answers (`sample` and `notes` say how far to trust them). When you change a tool, change its description in the same edit.

## Architecture

| Piece | Where | Job |
|---|---|---|
| Page queries | `app/Footprint/PageInteractions.php` | Every number for one page URL, range and device. Shared with the Interactions tab. |
| Site queries | `app/Footprint/SiteInteractions.php` | Every page of the site with the counts that point at trouble. |
| Blocks | `app/Footprint/Blocks.php` | Which page builder set each section renders from. |
| Journey | `app/Footprint/Journey.php` | A visit as lines an agent reads, with no id and no clock time. |
| Change | `app/Footprint/Change.php` | Before and after, with a noise flag. |
| Shared tool code | `app/Mcp/Tools/Concerns/ReadsInteractions.php` | Permission, page, range, cache, entry summary, `sample` and `notes`. |
| Tools | `app/Mcp/Tools/Interactions*.php` | Four read-only tools, each validate → authorize → find the page → ask a query class → shape. |
| Prompt | `app/Mcp/Prompts/ImprovePage.php` | The loop. |
| Server | `app/Mcp/StatamicServer.php` | Extends the addon's server, adds the tools and the prompt. |

The five `app/Footprint` classes know nothing about Statamic or MCP. The tools know nothing about SQL: they only use the query classes and the query methods of Footprint's models.

## Step 1: what must already be true

- `php please mcp:doctor` passes, and the tracker renders for guests only (`@guest @footprint @endguest`), so editors and preview frames record nothing.
- Sections are named after the page builder set they render, slugged, and a set used twice on a page is numbered. `Blocks` relies on exactly this:

  ```blade
  @php($seen = [])
  @foreach ($page_builder as $set)
      @php($seen[$set->type] = ($seen[$set->type] ?? 0) + 1)
      <section data-footprint-section="{{ Str::slug($set->type) }}{{ $seen[$set->type] > 1 ? '-'.$seen[$set->type] : '' }}">
          @include('sets.'.$set->type)
      </section>
  @endforeach
  ```

  Sections that are not sets, such as the header and the footer, keep their own names and come back with `block: null`.
- The `view interactions` permission exists. The Interactions tab skill registers it; otherwise add it in `AppServiceProvider::boot()`:

  ```php
  use Statamic\Facades\Permission;

  Permission::extend(function () {
      Permission::register('view interactions')->label('View page interactions');
  });
  ```

  Grant it, together with Access MCP, to the role of the user the agent connects as.

## Step 2: the query classes

- `PageInteractions`: when the app does not have it yet, copy the class from `footprint-statamic-interactions/references/queries.md`, in the Interactions tab skill. The controller below it is only for the tab.
- `SiteInteractions`, `Blocks`, `Journey` and `Change`: `references/analysis.md`.

## Step 3: the tools, the prompt and the server

All in `references/tools.md`: the shared trait, the four tools, the prompt, the server subclass and its config line. Copy them as they are, then adjust only what the site needs, such as the default range or limits.

- The trait uses the addon's `ResolvesEntries` and `ResolvesSites`, the lookups every built-in tool goes through, so an entry id honours the `resources` allowlist and site permissions exactly as `entries_get` does.
- The tools are read-only and marked `#[IsReadOnly]`, so they stay available when the server runs with `read_only`. `shouldRegister()` hides them when Footprint is disabled.
- Answers are cached for ten minutes per user and arguments.

## Rules

- The tools only read. They never write to Footprint's tables, and they never record the agent's own use.
- Visits carry no id and no time of day. This server also serves form submissions with their timestamps, and a visit that submitted the quote form at 14:03 next to a submission at 14:03 is a named person. Do not add either back, and do not add a tool that puts visits next to submissions, users or orders.
- Answers carry numbers that are already interpreted: dwell summed per view, medians, shares from 0 to 1. Never add a tool that returns raw Footprint rows or runs a query the agent writes: it would sum dwell deltas and join tables it must never join.
- Every answer names its entry and carries `sample` and `notes`. A new metric goes into a query class, its definition into the tool's description.
- Keep answers small: 15 clicks, 20 visits, 60 lines per visit. An agent reads every token.

## Testing

`laravel/mcp`'s test harness runs the tools against the app's server as a Statamic user. Seed Footprint the way production does, by posting batches to its ingest endpoint. The examples assume a `pages` collection routed at `/{slug}` whose blueprint has a `page_builder` Replicator with `hero` and `faq` sets; use the site's own.

```php
<?php

use App\Mcp\StatamicServer;
use App\Mcp\Tools\InteractionsGet;
use App\Mcp\Tools\InteractionsVisits;
use Illuminate\Support\Str;
use Statamic\Facades\Entry;
use Statamic\Facades\User;

function recordVisit(string $path, array $events, string $device = 'desktop'): string
{
    $id = (string) Str::uuid();

    test()->call('POST', '/footprint/events', server: [
        'CONTENT_TYPE' => 'text/plain',
        'HTTP_ORIGIN' => config('app.url'),
        'HTTP_USER_AGENT' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    ], content: json_encode([
        'v' => 1,
        'visit' => ['id' => $id, 'ref' => null, 'utm' => [], 'device' => $device, 'vw' => 1400, 'lang' => 'en'],
        'events' => array_map(fn (array $event) => ['t' => 100, 'view' => 1, 'path' => $path, ...$event], $events),
    ]))->assertNoContent();

    return $id;
}

it('ties each section to the block it renders from', function () {
    $entry = tap(Entry::make()->collection('pages')->slug('bikes')->data([
        'title' => 'Bikes',
        'page_builder' => [['id' => 'a', 'type' => 'hero'], ['id' => 'b', 'type' => 'faq']],
    ]))->save();

    recordVisit('/bikes', [['type' => 'view', 'from' => null], ['type' => 'section', 'section' => 'faq', 'i' => 1]]);

    StatamicServer::actingAs(tap(User::make()->email('agent@site.com')->makeSuper())->save())
        ->tool(InteractionsGet::class, ['id' => $entry->id()])
        ->assertOk()
        ->assertSee('"block":{"field":"page_builder","index":1,"type":"faq"}');
});

it('needs the view interactions permission', function () {
    StatamicServer::actingAs(tap(User::make()->email('editor@site.com'))->save())
        ->tool(InteractionsGet::class, ['url' => '/bikes'])
        ->assertHasErrors(["requires 'view interactions'"]);
});

it('never hands out a visit id', function () {
    $id = recordVisit('/bikes', [['type' => 'view', 'from' => null], ['type' => 'dead', 'target' => 'Bike photo', 'section' => 'hero']]);

    StatamicServer::actingAs(tap(User::make()->email('agent@site.com')->makeSuper())->save())
        ->tool(InteractionsVisits::class, ['url' => '/bikes', 'with' => 'dead'])
        ->assertOk()
        ->assertSee('dead click \"Bike photo\" in hero')
        ->assertDontSee($id);
});
```

Raise `footprint.rate_limit` in tests that post many batches. Also assert that a collection left out of the addon's `resources` setting answers "not found", and that `interactions_compare` refuses a change that has been live for under a day.
