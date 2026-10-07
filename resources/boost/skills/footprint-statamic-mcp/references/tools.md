# The tools, the server and the prompt

Every class here is glue: it checks who is asking, finds the page, fetches the page's HTML for `Vocabulary`, asks `Evidence` or `SiteInteractions` for the numbers, and shapes the answer. No tool reads Footprint's tables itself, so every answer keeps the promises in `analysis.md`. The descriptions are written for the agent on the other end of MCP, which never sees this skill or the Footprint README, so they carry every definition it needs. Keep them that way when you edit them.

## What the tools share

```php
<?php

namespace App\Mcp\Tools\Concerns;

use App\Footprint\Blocks;
use App\Footprint\Change;
use App\Footprint\Evidence;
use App\Footprint\PageInteractions;
use App\Footprint\Vocabulary;
use Carbon\CarbonInterface;
use Closure;
use Danielgnh\StatamicMcp\Tools\Concerns\ResolvesEntries;
use Danielgnh\StatamicMcp\Tools\Concerns\ResolvesSites;
use Danielgnh\StatamicMcp\Tools\ToolException;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Statamic\Contracts\Auth\User;
use Statamic\Contracts\Entries\Entry;
use Statamic\Facades\Data;
use Statamic\Facades\Site;
use Statamic\Facades\URL;
use Statamic\Fields\Field;
use Statamic\Structures\Page;

/**
 * The permission, the page, the date range, the page's own names, the cache,
 * and the fields that tell an agent how far to trust an answer.
 */
trait ReadsInteractions
{
    use ResolvesEntries;
    use ResolvesSites;

    public function shouldRegister(): bool
    {
        return (bool) config('footprint.enabled');
    }

    protected function pageSchema(JsonSchema $schema): array
    {
        return [
            'id' => $schema->string()->description('Entry id, as in entries_get. Pass id or url.'),
            'url' => $schema->string()->description('URL or path of an entry\'s page, e.g. /pricing.'),
        ];
    }

    protected function rangeSchema(JsonSchema $schema): array
    {
        return [
            'since' => $schema->string()->description('Start of the range, inclusive, e.g. 2026-09-01. Defaults to 30 days before before.'),
            'before' => $schema->string()->description('End of the range, exclusive, e.g. 2026-10-01 for everything up to the end of September. Defaults to now.'),
            'device' => $schema->string()->enum(['mobile', 'tablet', 'desktop'])->description('Only visits from this device class. Defaults to all.'),
        ];
    }

    protected function pageRules(): array
    {
        return [
            'id' => 'nullable|string',
            'url' => 'nullable|string|max:2048',
        ];
    }

    protected function rangeRules(): array
    {
        return [
            'since' => 'nullable|date',
            'before' => 'nullable|date',
            'device' => 'nullable|in:mobile,tablet,desktop',
        ];
    }

    /**
     * Only entries: any other path in Footprint's tables is a string some
     * browser sent, and nothing the site wrote.
     *
     * @return array{url: string, entry: Entry}
     */
    protected function page(Request $request, User $user): array
    {
        if (filled($id = $request->get('id'))) {
            $entry = $this->findExposedEntry((string) $id, $user);
            $this->ensurePermission($user, "view {$entry->collectionHandle()} entries");

            if (blank($entry->url())) {
                throw new ToolException("entry '{$entry->id()}' has no page: collection '{$entry->collectionHandle()}' has no route");
            }

            return ['url' => $entry->absoluteUrl(), 'entry' => $entry];
        }

        if (blank($request->get('url'))) {
            throw new ToolException('pass id, an entry id, or url, the URL or path of an entry\'s page');
        }

        $url = URL::makeAbsolute((string) $request->get('url'));
        $entry = $this->entryAt($url);

        if ($entry === null || ! $this->canSee($user, $entry)) {
            throw new ToolException("page '{$url}' not found: only entries you can see have interactions");
        }

        return ['url' => $url, 'entry' => $entry];
    }

    /**
     * Whether the agent may see a path on the page's host: an entry the user
     * can see.
     *
     * @return Closure(string): bool
     */
    protected function isPage(string $url, User $user): Closure
    {
        $host = (string) parse_url($url, PHP_URL_HOST);

        return function (string $path) use ($host, $user): bool {
            $entry = $this->entryAt($this->urlOf($host, $path));

            return $entry !== null && $this->canSee($user, $entry);
        };
    }

    /**
     * The names the live page contains, from pageHtml(), plus the custom
     * events listed in config/interactions.php. Cached per entry version for
     * a day; a failed fetch is not cached and hides every element name rather
     * than trusting them.
     *
     * @return array{0: Vocabulary, 1: bool} the vocabulary, and whether the page was fetched
     */
    protected function vocabulary(Entry $entry): array
    {
        $key = 'interactions:html:'.$entry->id().':'.$entry->lastModified()?->getTimestamp();
        $html = Cache::get($key);

        if ($html === null) {
            $html = $this->pageHtml($entry);

            if ($html !== '') {
                Cache::put($key, $html, now()->addDay());
            }
        }

        return [Vocabulary::fromHtml($html, config('interactions.events', [])), $html !== ''];
    }

    /**
     * The live page as a guest gets it, or an empty string when that fails.
     * A front end that renders in the browser, such as Inertia or a SPA
     * without SSR, sends HTML with none of the page's names in it: render the
     * page here instead (step 1 of the skill).
     */
    protected function pageHtml(Entry $entry): string
    {
        $response = rescue(fn () => Http::timeout(5)->get($entry->absoluteUrl()), report: false);

        return $response?->successful() ? $response->body() : '';
    }

    /**
     * The one place the tools build the shared query class. An app whose
     * PageInteractions takes something else than a URL adapts this method,
     * not the tools.
     */
    protected function report(string $url, CarbonInterface $from, CarbonInterface $to, ?string $device): PageInteractions
    {
        return new PageInteractions($url, $from, $to, $device);
    }

    /**
     * Footprint stores a host and a path; Statamic matches sites by full URL,
     * so the app URL's scheme fills the gap.
     */
    protected function urlOf(string $host, string $path): string
    {
        return (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https')."://{$host}{$path}";
    }

    /**
     * A page of a structured collection resolves to a Page that wraps the
     * entry and has no blueprint of its own.
     */
    protected function entryAt(string $url): ?Entry
    {
        $data = Data::findByRequestUrl($url);

        if ($data instanceof Page) {
            $data = $data->entry();
        }

        return $data instanceof Entry ? $data : null;
    }

    protected function siteAt(string $url): ?string
    {
        return Site::findByUrl($url)?->handle();
    }

    protected function canSee(User $user, Entry $entry): bool
    {
        return in_array($entry->collectionHandle(), $this->exposedHandles('collections'), true)
            && $this->canAccessSite($user, $entry->locale())
            && $this->can($user, "view {$entry->collectionHandle()} entries");
    }

    /**
     * @return array{0: CarbonInterface, 1: CarbonInterface}
     */
    protected function range(array $validated): array
    {
        $before = filled(data_get($validated, 'before'))
            ? Carbon::parse($validated['before'], config('app.timezone'))
            : now()->startOfMinute()->addMinute();
        $since = filled(data_get($validated, 'since'))
            ? Carbon::parse($validated['since'], config('app.timezone'))
            : $before->copy()->subDays(30)->startOfDay();

        if ($since->gte($before)) {
            throw new ToolException('since must come before before, e.g. since 2026-09-01 and before 2026-10-01');
        }

        return [$since, $before];
    }

    protected function window(CarbonInterface $since, CarbonInterface $before, ?string $device): array
    {
        return ['since' => $since->toIso8601String(), 'before' => $before->toIso8601String(), 'device' => $device];
    }

    protected function entry(Entry $entry): array
    {
        return [
            'id' => $entry->id(),
            'title' => $entry->value('title'),
            'collection' => $entry->collectionHandle(),
            'site' => $entry->locale(),
            'status' => $entry->status(),
            'last_modified' => $entry->lastModified()?->toIso8601String(),
            'cp_edit_url' => $entry->editUrl(),
        ];
    }

    /**
     * Where each section lives in the entry, from its Replicator and Bard
     * fields. The live entry: it is what visitors saw.
     */
    protected function blocks(Entry $entry): array
    {
        return Blocks::map($entry->blueprint()->fields()->all()
            ->filter(fn (Field $field): bool => in_array($field->type(), ['replicator', 'bard'], true))
            ->map(fn (Field $field): array => ['field' => $field->handle(), 'type' => $field->type(), 'value' => $entry->value($field->handle())])
            ->values()
            ->all());
    }

    /**
     * @return array{sample: array{views: int, visits: int}, notes: list<string>}
     */
    protected function trust(Entry $entry, CarbonInterface $since, CarbonInterface $before, Evidence $evidence, bool $fetched): array
    {
        $figures = $evidence->figures();
        $saved = $entry->lastModified();

        return [
            'sample' => ['views' => $figures['views'], 'visits' => $figures['visits']],
            'notes' => array_values(array_filter([
                $evidence->readable() ? null : sprintf('only %d views: under %d there are no shares or medians to read, only counts. Wait for more visits or widen the range', $figures['views'], Change::MIN_VIEWS),
                $saved?->between($since, $before) ? "the entry was saved on {$saved->toDateString()}, inside this range, so the numbers may mix two versions of the page; interactions_compare splits them" : null,
                $fetched ? null : 'element, section, field and form names are hidden: the live page could not be fetched to check them against',
            ])),
        ];
    }

    /**
     * Ten minutes per user and arguments: answers depend on what the user may
     * see, and the data only moves with new visits.
     */
    protected function remember(User $user, Request $request, Closure $answer): Response
    {
        $key = 'interactions:'.$this->name().':'.$user->id().':'.md5(serialize($request->all()));

        return $this->json(Cache::remember($key, now()->addMinutes(10), $answer));
    }
}
```

- `findExposedEntry()`, `canAccessSite()` and `resolveSite()` come from the addon's `ResolvesEntries` and `ResolvesSites`, the same lookups every built-in tool uses. An entry id therefore honours the `resources` allowlist and site permissions exactly as `entries_get` does.
- Pages that are not entries (custom routes, error pages, a path nobody built) never reach the agent. Footprint stores whatever path a browser posts, so a path is only trusted once Statamic resolves it to an entry.
- `pageHtml()` fetches the page over HTTP as a guest, so the names are the ones visitors get. A site behind basic auth or a single-threaded dev server (`php artisan serve`) cannot fetch itself: the tools then hide every name and say so in `notes`. A front end that renders in the browser needs `pageHtml()` to render the page; see step 1 of `SKILL.md`.

## interactions_overview

```php
<?php

namespace App\Mcp\Tools;

use App\Footprint\Change;
use App\Footprint\SiteInteractions;
use App\Mcp\Tools\Concerns\ReadsInteractions;
use Danielgnh\StatamicMcp\Tools\Tool;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('interactions_overview')]
#[Description('Start here to find pages that need work. Lists the site\'s entry pages over a date range with how visitors used them, from anonymous interaction data. Every view counts once, however many clicks it sent, and shares run from 0 to 1: scrolled_all, the share of views that reached the bottom of the page; frustrated, the share of views with a rage click (three fast presses on one spot) or a dead click (a click on something that is not a control and changed nothing); abandoned, the share of views that touched a form and left without submitting it. Pages under min_views (at least 30) are left out, because a handful of visits is not a pattern. Each page names its entry (id, title, collection, cp_edit_url): go on with interactions_get, then entries_get and entries_update to change it. sort ranks by views (default), frustrated, abandoned, or scroll (lowest share reaching the bottom first). Range: since (inclusive) and before (exclusive), default the last 30 days. Nothing here identifies a visitor; never try to link it to form submissions or anything else about a person.')]
#[IsReadOnly]
#[IsIdempotent]
class InteractionsOverview extends Tool
{
    use ReadsInteractions;

    #[\Override]
    public function schema(JsonSchema $schema): array
    {
        return [
            ...$this->rangeSchema($schema),
            'site' => $schema->string()->description('Site handle, to list one site\'s pages. Defaults to every site you can access.'),
            'sort' => $schema->string()->enum(['views', 'frustrated', 'abandoned', 'scroll'])->description('Ranking. Defaults to views.'),
            'min_views' => $schema->integer()->description('Leave out pages with fewer views. Defaults to 30, the lowest it goes.'),
            'limit' => $schema->integer()->description('Pages to return. Defaults to 20, at most 100.'),
        ];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([
            ...$this->rangeRules(),
            'site' => 'nullable|string',
            'sort' => 'nullable|in:views,frustrated,abandoned,scroll',
            'min_views' => 'nullable|integer|min:'.Change::MIN_VIEWS,
            'limit' => 'nullable|integer|min:1|max:100',
        ]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $site = filled(data_get($validated, 'site')) ? $this->resolveSite($request, $user) : null;
        [$since, $before] = $this->range($validated);
        $device = data_get($validated, 'device');
        $minViews = (int) (data_get($validated, 'min_views') ?? Change::MIN_VIEWS);

        return $this->remember($user, $request, fn (): array => [
            'range' => $this->window($since, $before, $device),
            'min_views' => $minViews,
            'pages' => (new SiteInteractions($since, $before, $device))
                ->pages($minViews)
                ->map(function (array $page): array {
                    $url = $this->urlOf($page['host'], $page['path']);

                    return [...$page, 'url' => $url, 'site' => $this->siteAt($url), 'entry' => $this->entryAt($url)];
                })
                ->filter(fn (array $page): bool => $page['entry'] !== null
                    && $this->canSee($user, $page['entry'])
                    && ($site === null || $page['site'] === $site))
                ->sortBy(fn (array $page): float => match (data_get($validated, 'sort')) {
                    'frustrated' => -$page['frustrated'],
                    'abandoned' => -$page['abandoned'],
                    'scroll' => $page['scrolled_all'],
                    default => -$page['views'],
                })
                ->take((int) (data_get($validated, 'limit') ?? 20))
                ->map(fn (array $page): array => [
                    'url' => $page['url'],
                    'entry' => $this->entry($page['entry']),
                    ...collect($page)->only(['views', 'visits', 'scrolled_all', 'frustrated', 'abandoned'])->all(),
                ])
                ->values(),
        ]);
    }
}
```

## interactions_get

```php
<?php

namespace App\Mcp\Tools;

use App\Footprint\Evidence;
use App\Mcp\Tools\Concerns\ReadsInteractions;
use Danielgnh\StatamicMcp\Tools\Tool;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('interactions_get')]
#[Description('How visitors use one page, from anonymous interaction data, to find out why it underperforms. Pass id (an entry id, as in entries_get) or url. Range: since (inclusive) and before (exclusive), default the last 30 days; device narrows to mobile, tablet or desktop, and without it by_device splits the figures. Every view counts once, however many events it sent, and shares run from 0 to 1. figures: views; visits; median_time_ms, the median time a view kept the page visible with the visitor active; scrolled_half and scrolled_all, shares of views reaching half and the bottom; rage, the share of views with a rage click (three fast presses on one spot); dead, the share with a dead click (a click on something that is not a control and changed nothing); abandoned, the share that touched a form and left without submitting it. goal: pass goal as submit:<form> or custom:<event> to get the share of views that reached it; null when the page has no such form or event. sections, in page order: reach, the share of views in which at least half of the section was on screen; drop, the reach lost since the section before; median_ms, the median time on screen in the views that reached it (null under 30 of them); block, where the section lives in the entry (field, index and type of its page builder set), so entries_update can edit, move or remove it; null for layout parts such as header and footer. scroll: share of views reaching each 10% step. clicks, frustration (rage and dead clicks), forms (each field\'s share of views focusing it and leaving on it, and the share submitting), custom (events the site sends itself), and flows (the pages views came from and went to next): each named row carries views and share. Rows under 10 views, and names that are not on the page as it is now, are summed into one row marked other, which carries only views and can count a view more than once. Under 30 views there are only counts; sample and notes say how far to trust the numbers, follow them. interactions_sequences shows what views did after one of these signals. Nothing here identifies a visitor; never try to link it to form submissions or anything else about a person.')]
#[IsReadOnly]
#[IsIdempotent]
class InteractionsGet extends Tool
{
    use ReadsInteractions;

    #[\Override]
    public function schema(JsonSchema $schema): array
    {
        return [
            ...$this->pageSchema($schema),
            ...$this->rangeSchema($schema),
            'goal' => $schema->string()->description('What the page should get visitors to do: submit:<form> or custom:<event>, as forms and custom list them, e.g. submit:quote.'),
        ];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([
            ...$this->pageRules(),
            ...$this->rangeRules(),
            'goal' => ['nullable', 'string', 'max:110', 'regex:/^(submit|custom):.+$/'],
        ]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $page = $this->page($request, $user);
        [$since, $before] = $this->range($validated);
        $device = data_get($validated, 'device');
        $goal = data_get($validated, 'goal');

        return $this->remember($user, $request, function () use ($page, $since, $before, $device, $goal, $user): array {
            [$vocabulary, $fetched] = $this->vocabulary($page['entry']);
            $evidence = new Evidence($this->report($page['url'], $since, $before, $device), $vocabulary);

            return [
                'page' => ['url' => $page['url'], 'entry' => $this->entry($page['entry'])],
                'range' => $this->window($since, $before, $device),
                ...$this->trust($page['entry'], $since, $before, $evidence, $fetched),
                'figures' => $evidence->figures(),
                'goal' => $goal === null ? null : ['metric' => $goal, 'share' => $evidence->measure($goal)],
                'by_device' => $device === null
                    ? collect(['mobile', 'tablet', 'desktop'])->mapWithKeys(fn (string $class): array => [
                        $class => (new Evidence($this->report($page['url'], $since, $before, $class), $vocabulary))->figures(),
                    ])
                    : null,
                'sections' => $evidence->sections($this->blocks($page['entry'])),
                'scroll' => $evidence->scroll(),
                'clicks' => $evidence->clicks(),
                'frustration' => $evidence->frustration(),
                'forms' => $evidence->forms(),
                'flows' => $evidence->flows($this->isPage($page['url'], $user)),
                'custom' => $evidence->custom(),
            ];
        });
    }
}
```

## interactions_sequences

```php
<?php

namespace App\Mcp\Tools;

use App\Footprint\Evidence;
use App\Mcp\Tools\Concerns\ReadsInteractions;
use Danielgnh\StatamicMcp\Tools\Tool;
use Danielgnh\StatamicMcp\Tools\ToolException;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('interactions_sequences')]
#[Description('What visitors did right after a signal on a page, as counts of views, to understand a number from interactions_get: what people tried after dead-clicking the hero image, or where they went after leaving the quote form at the email field. Pass id (an entry id) or url, after (rage, dead, abandon, field, click, submit or custom), and target, the element, field, form or event name exactly as interactions_get lists it; for abandon it is the field the form was left on, for submit the form. views: how many views had the signal, each counted once. next: the next thing those views did on the page (type, target, section), skipping repeats of the signal itself. nothing_next: views that did nothing else on the page afterwards. ended: how many of the views then submitted a form, moved to another page, or left. moved_to: the pages they moved to. median_seconds_to_next: median seconds from the signal to the next action, null under 30 views. Rows under 10 views, and names that are not on the page, are summed into one row marked other; under 10 views with the signal, only views comes back. Range: since (inclusive) and before (exclusive), default the last 30 days. Nothing here describes a single visit or identifies a visitor.')]
#[IsReadOnly]
#[IsIdempotent]
class InteractionsSequences extends Tool
{
    use ReadsInteractions;

    #[\Override]
    public function schema(JsonSchema $schema): array
    {
        return [
            ...$this->pageSchema($schema),
            ...$this->rangeSchema($schema),
            'after' => $schema->string()->enum(['rage', 'dead', 'abandon', 'field', 'click', 'submit', 'custom'])->description('The signal.')->required(),
            'target' => $schema->string()->description('The element, field, form or event name, as interactions_get lists it. Without it, any signal of that kind.'),
        ];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([
            ...$this->pageRules(),
            ...$this->rangeRules(),
            'after' => 'required|in:rage,dead,abandon,field,click,submit,custom',
            'target' => 'nullable|string|max:100',
        ]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $page = $this->page($request, $user);
        [$since, $before] = $this->range($validated);
        $device = data_get($validated, 'device');

        return $this->remember($user, $request, function () use ($page, $since, $before, $device, $validated, $user): array {
            [$vocabulary, $fetched] = $this->vocabulary($page['entry']);
            $evidence = new Evidence($this->report($page['url'], $since, $before, $device), $vocabulary);
            $after = $evidence->after($validated['after'], data_get($validated, 'target'), $this->isPage($page['url'], $user));

            if ($after === null) {
                throw new ToolException($fetched
                    ? "'{$validated['target']}' is not on the page: pass a name exactly as interactions_get lists it"
                    : 'the live page could not be fetched, so names cannot be checked: leave out target, or try again later');
            }

            return [
                'page' => ['url' => $page['url'], 'entry' => $this->entry($page['entry'])],
                'range' => $this->window($since, $before, $device),
                ...$this->trust($page['entry'], $since, $before, $evidence, $fetched),
                'after' => ['type' => $validated['after'], 'target' => data_get($validated, 'target')],
                ...$after,
            ];
        });
    }
}
```

## interactions_compare

```php
<?php

namespace App\Mcp\Tools;

use App\Footprint\Change;
use App\Footprint\Evidence;
use App\Mcp\Tools\Concerns\ReadsInteractions;
use Danielgnh\StatamicMcp\Tools\Tool;
use Danielgnh\StatamicMcp\Tools\ToolException;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('interactions_compare')]
#[Description('Did a change to a page work? Tests one metric, the one your hypothesis named before the change, as a share of views before and after at, the moment the change went live, over two windows of the same length. metric is one of scrolled_half, scrolled_all, rage, dead, abandon (shares of views, as in interactions_get), or a name after a colon: submit:<form> and custom:<event> for a goal, click:<element> for the share of views clicking it, reach:<section> for a section\'s reach. Pass id (an entry id) or url; at defaults to the entry\'s last save, so pass it when the change was published later or when later saves did not change the page. days sets the window length, defaulting to the time since at, at most 30. metric comes back as before, after, change and noise: noise is true when the difference is within two standard errors; report it as inconclusive then, never as a result. A null side means that window had under 30 views or the page did not have it there, often because the change added or removed it; noise is null then, so nothing can be said yet. context holds the other figures and section reach before and after with no verdict: it describes, it does not prove, so never report a change in it as a result. Anything else that changed between the windows, such as a campaign, a season or another page, moves these numbers too; say so when you report. Nothing here identifies a visitor.')]
#[IsReadOnly]
#[IsIdempotent]
class InteractionsCompare extends Tool
{
    use ReadsInteractions;

    #[\Override]
    public function schema(JsonSchema $schema): array
    {
        return [
            ...$this->pageSchema($schema),
            'metric' => $schema->string()->description('The one metric the change should move, e.g. click:Build yours, reach:pricing or submit:quote.')->required(),
            'at' => $schema->string()->description('When the change went live, e.g. 2026-09-30T14:00:00+02:00. Defaults to the entry\'s last save.'),
            'days' => $schema->integer()->description('Length of each window in days. Defaults to the time since at, at most 30.'),
            'device' => $schema->string()->enum(['mobile', 'tablet', 'desktop'])->description('Only visits from this device class. Defaults to all.'),
        ];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([
            ...$this->pageRules(),
            'metric' => ['required', 'string', 'max:110', 'regex:/^(scrolled_half|scrolled_all|rage|dead|abandon|(submit|custom|click|reach):.+)$/'],
            'at' => 'nullable|date',
            'days' => 'nullable|integer|min:1|max:90',
            'device' => 'nullable|in:mobile,tablet,desktop',
        ]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $page = $this->page($request, $user);
        $device = data_get($validated, 'device');
        $metric = $validated['metric'];

        $at = filled(data_get($validated, 'at'))
            ? Carbon::parse($validated['at'], config('app.timezone'))
            : $page['entry']->lastModified();

        if ($at === null) {
            throw new ToolException('pass at, when the change went live: the entry has no last save to default to');
        }

        $seconds = min((int) (data_get($validated, 'days') ?? 30) * 86_400, now()->getTimestamp() - $at->getTimestamp());

        if ($seconds < 86_400) {
            throw new ToolException('the change has been live for under a day: compare once it has run for a few days, and a week covers every weekday');
        }

        return $this->remember($user, $request, function () use ($page, $at, $seconds, $device, $metric): array {
            [$vocabulary, $fetched] = $this->vocabulary($page['entry']);
            $old = new Evidence($this->report($page['url'], $at->copy()->subSeconds($seconds), $at, $device), $vocabulary);
            $new = new Evidence($this->report($page['url'], $at, $at->copy()->addSeconds($seconds), $device), $vocabulary);
            $was = $old->figures();
            $is = $new->figures();
            $before = $old->measure($metric);
            $after = $new->measure($metric);

            if ($before === null && $after === null && $old->readable() && $new->readable()) {
                throw new ToolException($fetched
                    ? "the page has no '{$metric}' in either window: name a form, event, element or section as interactions_get lists it"
                    : 'the live page could not be fetched, so names cannot be checked: compare scrolled_half, scrolled_all, rage, dead or abandon, or try again later');
            }

            $blocks = $this->blocks($page['entry']);
            $then = $old->sections($blocks)->keyBy('section');
            $now = $new->sections($blocks)->keyBy('section');

            return [
                'page' => ['url' => $page['url'], 'entry' => $this->entry($page['entry'])],
                'at' => $at->toIso8601String(),
                'before' => [...$this->window($at->copy()->subSeconds($seconds), $at, $device), 'views' => $was['views'], 'visits' => $was['visits']],
                'after' => [...$this->window($at, $at->copy()->addSeconds($seconds), $device), 'views' => $is['views'], 'visits' => $is['visits']],
                'metric' => ['name' => $metric, ...Change::share($before, $was['views'], $after, $is['views'])],
                'context' => [
                    'figures' => collect(['median_time_ms', 'scrolled_half', 'scrolled_all', 'rage', 'dead', 'abandoned'])
                        ->mapWithKeys(fn (string $figure): array => [$figure => ['before' => data_get($was, $figure), 'after' => data_get($is, $figure)]]),
                    'sections' => $now->keys()->merge($then->keys())->unique()->map(fn (string $section): array => [
                        'section' => $section,
                        'reach' => ['before' => data_get($then->get($section), 'reach'), 'after' => data_get($now->get($section), 'reach')],
                        'block' => data_get($now->get($section) ?? $then->get($section), 'block'),
                    ])->values(),
                ],
                'notes' => array_values(array_filter([
                    $seconds < 7 * 86_400 ? sprintf('each window is %.1f days, so the weekdays differ between them; a week or more reads better', $seconds / 86_400) : null,
                    min($was['views'], $is['views']) < Change::MIN_VIEWS ? 'a window has under 30 views: the metric cannot be read yet and context is empty there; compare again later' : null,
                ])),
            ];
        });
    }
}
```

`block` in `context` is where the section lives in the entry now, since the old version of the page is gone.

## The prompt

```php
<?php

namespace App\Mcp\Prompts;

use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Prompt;
use Laravel\Mcp\Server\Prompts\Argument;

#[Name('improve_page')]
#[Description('Find out from how visitors use a page why it underperforms, change it as a draft for an editor to publish, and measure the change once it is live.')]
class ImprovePage extends Prompt
{
    public function arguments(): array
    {
        return [
            new Argument('page', 'The page: an entry id, a URL or a path.', required: true),
            new Argument('goal', 'What the page should get visitors to do, as submit:<form> or custom:<event>, e.g. submit:quote.'),
        ];
    }

    public function handle(Request $request): Response
    {
        $validated = $request->validate(['page' => 'required|string', 'goal' => 'nullable|string']);
        $goal = filled(data_get($validated, 'goal')) ? " Its goal is {$validated['goal']}: pass it as goal to interactions_get, and prefer it as the metric in step 4." : '';

        return Response::text(<<<TEXT
            Improve the page {$validated['page']}.{$goal} Work through these steps, and back every claim with the numbers you got.

            1. Call interactions_get for the page. If its notes say there are too few views, report what you see and stop there.
            2. Name the single biggest problem: the section where reach drops most, a share of views with rage or dead clicks on one element, the form field views leave on, or a device doing far worse than the others.
            3. Call interactions_sequences with that signal (after, target) and say what visitors were trying to do, from what they did next.
            4. State one hypothesis, the one change that tests it, and the one metric it should move, written as interactions_compare takes it (click:<element>, reach:<section>, submit:<form>, ...). Change one thing, so the result can be read.
            5. Call blueprints_get and entries_get, then entries_update with the change. A section's block says which page builder set to edit, move or remove. Check the result with entries_preview.
            6. You cannot publish. Tell the editor what you changed, why, and the metric to check, and that it needs publishing.
            7. Once the change has been live for at least a week, call interactions_compare with at set to when it went live and metric set to the one you named. Report its verdict; context only describes and is never a result.
            TEXT);
    }
}
```

## The server

```php
<?php

namespace App\Mcp;

use App\Mcp\Prompts\ImprovePage;
use App\Mcp\Tools\InteractionsCompare;
use App\Mcp\Tools\InteractionsGet;
use App\Mcp\Tools\InteractionsOverview;
use App\Mcp\Tools\InteractionsSequences;
use Danielgnh\StatamicMcp\Server;
use Danielgnh\StatamicMcp\ToolRegistry;

class StatamicServer extends Server
{
    protected array $prompts = [
        ImprovePage::class,
    ];

    #[\Override]
    protected function tools(ToolRegistry $tools): void
    {
        $tools->add(
            InteractionsOverview::class,
            InteractionsGet::class,
            InteractionsSequences::class,
            InteractionsCompare::class,
        );
    }
}
```

```php
// config/statamic/mcp.php
'server' => App\Mcp\StatamicServer::class,
```

- When the app already has its own server class, add the four tools and the prompt to it.
- Do not redeclare `#[Instructions]` on the subclass. laravel/mcp reads the subclass's attribute instead of the addon's, so it would replace the addon's instructions rather than add to them. The tool descriptions and the prompt carry everything the agent needs.
