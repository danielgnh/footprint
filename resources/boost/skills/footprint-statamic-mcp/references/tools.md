# The tools, the server and the prompt

Every class here is glue: it checks who is asking, finds the page, asks `PageInteractions`, `SiteInteractions`, `Blocks`, `Journey` or `Change` for the numbers, and shapes the answer. The descriptions are written for the agent on the other end of MCP, which never sees this skill or the Footprint README, so they carry every definition it needs. Keep them that way when you edit them.

## What the tools share

```php
<?php

namespace App\Mcp\Tools\Concerns;

use App\Footprint\Blocks;
use App\Footprint\Change;
use Carbon\CarbonInterface;
use Closure;
use Danielgnh\StatamicMcp\Tools\Concerns\ResolvesEntries;
use Danielgnh\StatamicMcp\Tools\Concerns\ResolvesSites;
use Danielgnh\StatamicMcp\Tools\ToolException;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Statamic\Contracts\Auth\User;
use Statamic\Contracts\Entries\Entry;
use Statamic\Facades\Data;
use Statamic\Facades\Site;
use Statamic\Facades\URL;
use Statamic\Fields\Field;

/**
 * The permission, the page, the date range, the cache, and the fields that
 * tell an agent how far to trust an answer.
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
            'url' => $schema->string()->description('Page URL or path, e.g. /pricing. Use it for pages that are not entries.'),
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
     * @return array{url: string, entry: ?Entry}
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
            throw new ToolException('pass id, an entry id, or url, a page URL or path');
        }

        $url = URL::makeAbsolute((string) $request->get('url'));
        $entry = $this->entryAt($url);

        if ($entry !== null && ! $this->canSee($user, $entry)) {
            throw new ToolException("page '{$url}' not found");
        }

        return ['url' => $url, 'entry' => $entry];
    }

    /**
     * Footprint stores a host and a path; Statamic matches sites by full URL,
     * so the app URL's scheme fills the gap.
     */
    protected function urlOf(string $host, string $path): string
    {
        return (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https')."://{$host}{$path}";
    }

    protected function entryAt(string $url): ?Entry
    {
        $data = Data::findByRequestUrl($url);

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

    protected function entry(?Entry $entry): ?array
    {
        if ($entry === null) {
            return null;
        }

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
    protected function blocks(?Entry $entry): array
    {
        if ($entry === null) {
            return [];
        }

        return Blocks::map($entry->blueprint()->fields()->all()
            ->filter(fn (Field $field): bool => in_array($field->type(), ['replicator', 'bard'], true))
            ->map(fn (Field $field): array => ['field' => $field->handle(), 'type' => $field->type(), 'value' => $entry->value($field->handle())])
            ->values()
            ->all());
    }

    /**
     * @return array{sample: array{views: int, visits: int}, notes: list<string>}
     */
    protected function trust(?Entry $entry, CarbonInterface $since, CarbonInterface $before, int $views, int $visits): array
    {
        $saved = $entry?->lastModified();

        return [
            'sample' => ['views' => $views, 'visits' => $visits],
            'notes' => array_values(array_filter([
                $views < Change::MIN_VIEWS ? "only {$views} views: quote counts, and treat any pattern as a hunch until there are more" : null,
                $saved?->between($since, $before) ? "the entry was saved on {$saved->toDateString()}, inside this range, so the numbers may mix two versions of the page; interactions_compare splits them" : null,
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
- Pages that are not entries (custom routes, error pages) are open to anyone with `view interactions`: they are public pages, and Footprint only has what visitors did there.

## interactions_overview

```php
<?php

namespace App\Mcp\Tools;

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
#[Description('Start here to find pages that need work. Lists the site\'s pages over a date range with how visitors used them, from anonymous interaction data: views; visits; scrolled_all, the share of views that reached the bottom of the page; frustration_per_100, rage clicks (three fast presses on one spot) plus dead clicks (a click on something that is not a control and changed nothing) per 100 views; and abandons_per_100, views that touched a form and left without submitting it, per 100 views. Pages under min_views are left out, because a handful of visits is not a pattern. A page that is an entry names it (id, title, collection, cp_edit_url): go on with interactions_get, then entries_get and entries_update to change it. sort ranks by views (default), frustration, abandons, or scroll (lowest share reaching the bottom first). Range: since (inclusive) and before (exclusive), default the last 30 days. Nothing here identifies a visitor; never try to link it to form submissions or anything else about a person.')]
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
            'sort' => $schema->string()->enum(['views', 'frustration', 'abandons', 'scroll'])->description('Ranking. Defaults to views.'),
            'min_views' => $schema->integer()->description('Leave out pages with fewer views. Defaults to 30.'),
            'limit' => $schema->integer()->description('Pages to return. Defaults to 20, at most 100.'),
        ];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([
            ...$this->rangeRules(),
            'site' => 'nullable|string',
            'sort' => 'nullable|in:views,frustration,abandons,scroll',
            'min_views' => 'nullable|integer|min:1',
            'limit' => 'nullable|integer|min:1|max:100',
        ]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $site = filled(data_get($validated, 'site')) ? $this->resolveSite($request, $user) : null;
        [$since, $before] = $this->range($validated);
        $device = data_get($validated, 'device');
        $minViews = (int) (data_get($validated, 'min_views') ?? 30);

        return $this->remember($user, $request, fn (): array => [
            'range' => $this->window($since, $before, $device),
            'min_views' => $minViews,
            'pages' => (new SiteInteractions($since, $before, $device))
                ->pages($minViews)
                ->map(function (array $page): array {
                    $url = $this->urlOf($page['host'], $page['path']);

                    return [...$page, 'url' => $url, 'site' => $this->siteAt($url), 'entry' => $this->entryAt($url)];
                })
                ->filter(fn (array $page): bool => ($page['site'] === null || $this->canAccessSite($user, $page['site']))
                    && ($page['entry'] === null || $this->canSee($user, $page['entry']))
                    && ($site === null || $page['site'] === $site))
                ->sortBy(fn (array $page): float => match (data_get($validated, 'sort')) {
                    'frustration' => -$page['frustration_per_100'],
                    'abandons' => -$page['abandons_per_100'],
                    'scroll' => $page['scrolled_all'],
                    default => -$page['views'],
                })
                ->take((int) (data_get($validated, 'limit') ?? 20))
                ->map(fn (array $page): array => [
                    'url' => $page['url'],
                    'entry' => $this->entry($page['entry']),
                    ...collect($page)->only(['views', 'visits', 'scrolled_all', 'frustration_per_100', 'abandons_per_100'])->all(),
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

use App\Footprint\PageInteractions;
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
#[Description('How visitors use one page, from anonymous interaction data, to find out why it underperforms. Pass id (an entry id, as in entries_get) or url. Range: since (inclusive) and before (exclusive), default the last 30 days; device narrows to mobile, tablet or desktop, and without it by_device splits the figures. figures: views; visits; median_time_ms, the median time a view kept the page visible with the visitor active; scrolled_half and scrolled_all, shares of views reaching half and the bottom; rage, three fast presses on one spot; dead, a click on something that is not a control and changed nothing; abandons, views that touched a form and left without submitting it. sections, in page order: reach, the share of views in which at least half of the section was on screen; drop, the reach lost since the section before; median_ms, the median time on screen in the views that reached it; block, where the section lives in the entry (field, index and type of its page builder set), so entries_update can edit, move or remove it; null for layout parts such as header and footer. scroll: share of views reaching each 10% step. clicks: elements by name, with the share of visits that clicked them. frustration: rage and dead clicks by element and section. forms: each field\'s focus and abandon counts, and submits. flows: previous and next pages, and the sources that started visits here. custom: events the site sends itself. Shares run from 0 to 1. sample and notes say how far to trust the numbers; follow them. interactions_visits shows the visits behind a number. Nothing here identifies a visitor; never try to link it to form submissions or anything else about a person.')]
#[IsReadOnly]
#[IsIdempotent]
class InteractionsGet extends Tool
{
    use ReadsInteractions;

    #[\Override]
    public function schema(JsonSchema $schema): array
    {
        return [...$this->pageSchema($schema), ...$this->rangeSchema($schema)];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([...$this->pageRules(), ...$this->rangeRules()]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $page = $this->page($request, $user);
        [$since, $before] = $this->range($validated);
        $device = data_get($validated, 'device');

        return $this->remember($user, $request, function () use ($page, $since, $before, $device): array {
            $report = new PageInteractions($page['url'], $since, $before, $device);
            $figures = $report->figures();
            $sections = $report->sections();
            $blocks = $this->blocks($page['entry']);

            return [
                'page' => ['url' => $page['url'], 'entry' => $this->entry($page['entry'])],
                'range' => $this->window($since, $before, $device),
                ...$this->trust($page['entry'], $since, $before, $figures['views'], $figures['visits']),
                'figures' => $figures,
                'by_device' => $device === null
                    ? collect(['mobile', 'tablet', 'desktop'])->mapWithKeys(fn (string $class): array => [$class => (new PageInteractions($page['url'], $since, $before, $class))->figures()])
                    : null,
                'sections' => $sections->map(fn (array $section, int $i): array => [
                    'section' => $section['section'],
                    'reach' => $section['reach'],
                    'drop' => $i === 0 ? null : round($sections[$i - 1]['reach'] - $section['reach'], 3),
                    'median_ms' => $section['median_ms'],
                    'block' => $blocks[$section['section']] ?? null,
                ]),
                'scroll' => $report->scroll(),
                'clicks' => $report->clicks(15),
                'frustration' => $report->frustration(15),
                'forms' => $report->forms(),
                'flows' => $report->flows(),
                'custom' => $report->custom(),
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
use App\Footprint\PageInteractions;
use App\Mcp\Tools\Concerns\ReadsInteractions;
use Danielgnh\StatamicMcp\Tools\Tool;
use Danielgnh\StatamicMcp\Tools\ToolException;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('interactions_compare')]
#[Description('Did a change to a page work? Compares how visitors used it before and after at, the moment the change went live, over two windows of the same length. Pass id (an entry id) or url; at defaults to the entry\'s last save, so pass it when the change was published later or when later saves did not change the page. days sets the window length, defaulting to the time since at, at most 30. Each metric comes back as before, after, change and noise. noise is true when either window has under 30 views or the difference is within two standard errors: report those as inconclusive, never as a result. figures compares median time on page, the shares of views scrolling to half and to the bottom, and rage clicks, dead clicks and form abandons per view. sections compares each section\'s reach and median time on screen, with its block in the entry; null on one side means no view reached that section in that window, often because the change added or removed it. clicks compares the share of visits clicking the most clicked elements. Anything else that changed between the windows, such as a campaign, a season or another page, moves these numbers too; say so when you report. Nothing here identifies a visitor.')]
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
            'at' => $schema->string()->description('When the change went live, e.g. 2026-09-30T14:00:00+02:00. Defaults to the entry\'s last save; required for a page that is not an entry.'),
            'days' => $schema->integer()->description('Length of each window in days. Defaults to the time since at, at most 30.'),
            'device' => $schema->string()->enum(['mobile', 'tablet', 'desktop'])->description('Only visits from this device class. Defaults to all.'),
        ];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([
            ...$this->pageRules(),
            'at' => 'nullable|date',
            'days' => 'nullable|integer|min:1|max:90',
            'device' => 'nullable|in:mobile,tablet,desktop',
        ]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $page = $this->page($request, $user);
        $device = data_get($validated, 'device');

        $at = filled(data_get($validated, 'at'))
            ? Carbon::parse($validated['at'], config('app.timezone'))
            : $page['entry']?->lastModified();

        if ($at === null) {
            throw new ToolException('pass at, when the change went live: this page is not an entry, so there is no last save to default to');
        }

        $seconds = min((int) (data_get($validated, 'days') ?? 30) * 86_400, now()->getTimestamp() - $at->getTimestamp());

        if ($seconds < 86_400) {
            throw new ToolException('the change has been live for under a day: compare once it has run for a few days, and a week covers every weekday');
        }

        $old = new PageInteractions($page['url'], $at->copy()->subSeconds($seconds), $at, $device);
        $new = new PageInteractions($page['url'], $at, $at->copy()->addSeconds($seconds), $device);

        return $this->remember($user, $request, function () use ($page, $at, $seconds, $device, $old, $new): array {
            $was = $old->figures();
            $is = $new->figures();

            return [
                'page' => ['url' => $page['url'], 'entry' => $this->entry($page['entry'])],
                'at' => $at->toIso8601String(),
                'before' => [...$this->window($at->copy()->subSeconds($seconds), $at, $device), 'views' => $was['views'], 'visits' => $was['visits']],
                'after' => [...$this->window($at, $at->copy()->addSeconds($seconds), $device), 'views' => $is['views'], 'visits' => $is['visits']],
                'figures' => [
                    'median_time_ms' => Change::median($was['median_time_ms'], $was['views'], $is['median_time_ms'], $is['views']),
                    'scrolled_half' => Change::share($was['scrolled_half'], $was['views'], $is['scrolled_half'], $is['views']),
                    'scrolled_all' => Change::share($was['scrolled_all'], $was['views'], $is['scrolled_all'], $is['views']),
                    ...collect(['rage', 'dead', 'abandons'])->mapWithKeys(fn (string $count): array => [
                        "{$count}_per_view" => Change::rate($was[$count] / max(1, $was['views']), $was['views'], $is[$count] / max(1, $is['views']), $is['views']),
                    ]),
                ],
                'sections' => $this->sections($old->sections(), $new->sections(), $was['views'], $is['views'], $this->blocks($page['entry'])),
                'clicks' => $this->clicks($old->clicks(50), $new->clicks(10), $was['visits'], $is['visits']),
                'notes' => array_values(array_filter([
                    $seconds < 7 * 86_400 ? sprintf('each window is %.1f days, so the weekdays differ between them; a week or more reads better', $seconds / 86_400) : null,
                    min($was['views'], $is['views']) < Change::MIN_VIEWS ? 'a window has under 30 views: every change is flagged as noise' : null,
                ])),
            ];
        });
    }

    private function sections(Collection $old, Collection $new, int $wasViews, int $isViews, array $blocks): Collection
    {
        $then = $old->keyBy('section');
        $now = $new->keyBy('section');

        return $now->keys()->merge($then->keys())->unique()->map(fn (string $section): array => [
            'section' => $section,
            'reach' => Change::share(data_get($then->get($section), 'reach'), $wasViews, data_get($now->get($section), 'reach'), $isViews),
            'median_ms' => $then->has($section) && $now->has($section)
                ? Change::median($then[$section]['median_ms'], $wasViews, $now[$section]['median_ms'], $isViews)
                : null,
            'block' => $blocks[$section] ?? null,
        ])->values();
    }

    private function clicks(Collection $old, Collection $new, int $wasVisits, int $isVisits): Collection
    {
        $then = $old->keyBy(fn (array $click): string => $click['target'].'|'.$click['section']);

        return $new->map(fn (array $click): array => [
            'target' => $click['target'],
            'section' => $click['section'],
            'share' => Change::share((float) data_get($then->get($click['target'].'|'.$click['section']), 'share', 0), $wasVisits, $click['share'], $isVisits),
        ])->values();
    }
}
```

## interactions_visits

```php
<?php

namespace App\Mcp\Tools;

use App\Footprint\Journey;
use App\Mcp\Tools\Concerns\ReadsInteractions;
use Danielgnh\Footprint\Models\Visit;
use Danielgnh\StatamicMcp\Tools\Tool;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('interactions_visits')]
#[Description('What visitors did, step by step: recent visits to a page, newest first, each as lines of seconds since the visit started and what happened (views, sections reached, scroll depth, clicks with their element and section, rage and dead clicks, form fields focused, submits, where a form was left, custom events). Read them to understand a number from interactions_get: pass with and target to see only visits that, say, abandoned the quote form at the email field, or dead-clicked the hero image. Each visit carries its device, viewport width, language, referrer host and campaign, and covers every page of the visit, not only this one. Pass id (an entry id) or url. Range: since (inclusive) and before (exclusive), default the last 30 days. Visits are evidence for a hypothesis, not people: there is no id and no time of day, and you must never try to match a visit to a form submission, an order, a log line or anything else about a person.')]
#[IsReadOnly]
#[IsIdempotent]
class InteractionsVisits extends Tool
{
    use ReadsInteractions;

    #[\Override]
    public function schema(JsonSchema $schema): array
    {
        return [
            ...$this->pageSchema($schema),
            ...$this->rangeSchema($schema),
            'with' => $schema->string()->enum(['click', 'rage', 'dead', 'field', 'submit', 'abandon', 'custom'])->description('Only visits with this event on the page. Defaults to every visit that viewed it.'),
            'target' => $schema->string()->description('With with: the element, field or custom event name, as interactions_get lists it.'),
            'limit' => $schema->integer()->description('Visits to return. Defaults to 10, at most 20.'),
        ];
    }

    protected function execute(Request $request): Response
    {
        $validated = $request->validate([
            ...$this->pageRules(),
            ...$this->rangeRules(),
            'with' => 'nullable|in:click,rage,dead,field,submit,abandon,custom',
            'target' => 'nullable|string|max:100',
            'limit' => 'nullable|integer|min:1|max:20',
        ]);

        $user = $this->user($request);
        $this->ensurePermission($user, 'view interactions');

        $page = $this->page($request, $user);
        [$since, $before] = $this->range($validated);
        $device = data_get($validated, 'device');

        return $this->remember($user, $request, fn (): array => [
            'page' => ['url' => $page['url'], 'entry' => $this->entry($page['entry'])],
            'range' => $this->window($since, $before, $device),
            'visits' => Visit::query()
                ->whereHas('footprints', fn ($events) => $events
                    ->onPage($page['url'])
                    ->between($since, $before)
                    ->ofType(data_get($validated, 'with') ?? 'view')
                    ->when(data_get($validated, 'target'), fn ($events, string $target) => $events->where('target', $target)))
                ->when($device, fn ($visits, string $device) => $visits->onDevice($device))
                ->with(['footprints' => fn ($events) => $events->timeline()])
                ->latest('started_at')
                ->limit((int) (data_get($validated, 'limit') ?? 10))
                ->get()
                ->map(fn (Visit $visit): array => [
                    'device' => $visit->device,
                    'viewport' => $visit->viewport,
                    'lang' => $visit->lang,
                    'referrer' => $visit->referrer_host,
                    'campaign' => $visit->utm_source,
                    'seconds' => (int) round($visit->footprints->max('t') / 1000),
                    'steps' => Journey::lines($visit->footprints),
                ]),
        ]);
    }
}
```

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
#[Description('Find out from how visitors use a page why it underperforms, change it as a draft, and measure the change once it is live.')]
class ImprovePage extends Prompt
{
    public function arguments(): array
    {
        return [
            new Argument('page', 'The page: an entry id, a URL or a path.', required: true),
            new Argument('goal', 'What the page should get visitors to do, e.g. "start the configurator".'),
        ];
    }

    public function handle(Request $request): Response
    {
        $validated = $request->validate(['page' => 'required|string', 'goal' => 'nullable|string']);
        $goal = filled(data_get($validated, 'goal')) ? " Its goal: {$validated['goal']}." : '';

        return Response::text(<<<TEXT
            Improve the page {$validated['page']}.{$goal} Work through these steps, and back every claim with the numbers you got.

            1. Call interactions_get for the page. If its notes say the sample is small, report what you see and stop there.
            2. Name the single biggest problem: the section where reach drops most, rage or dead clicks on one element, the form field visitors leave on, or a device doing far worse than the others.
            3. Call interactions_visits with that signal (with, target) and read the visits. Say what visitors were trying to do.
            4. State one hypothesis and the one change that tests it. Change one thing, so the result can be read.
            5. Call blueprints_get and entries_get, then entries_update with the change. A section's block says which page builder set to edit, move or remove. Check the result with entries_preview.
            6. Do not publish unless you were asked to. Tell the editor what you changed, why, and that it needs publishing.
            7. Once the change has been live for at least a week, call interactions_compare with at set to when it went live. Report the changes not flagged as noise, and call the rest inconclusive.
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
use App\Mcp\Tools\InteractionsVisits;
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
            InteractionsCompare::class,
            InteractionsVisits::class,
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
