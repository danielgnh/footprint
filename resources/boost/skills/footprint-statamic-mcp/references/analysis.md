# Analysis classes for the MCP tools

Small classes the tools lean on. None of them knows about Statamic or MCP: they take Footprint rows, HTML or plain arrays and return plain arrays, so they are unit-testable on their own. Per-page numbers come from `App\Footprint\PageInteractions`, shared with the Interactions tab (step 2 of `SKILL.md`).

They exist to keep three promises to the agent:

- Every view votes once. Frequencies are shares of views, counted through Footprint's `perView()`, never raw events.
- Every number covers enough views: `Change::MIN_VIEWS` for a share or a median, `Chunks::MIN_GROUP` for a named row.
- Every name is one the site wrote. Anyone can post to the ingest endpoint, so a name in the data proves nothing until `Vocabulary` finds it on the page.

`Evidence` keeps all three for one page, and the tools only shape what it returns. Change it, not a tool, when the agent should see something new.

## Every page of a site

```php
<?php

namespace App\Footprint;

use Carbon\CarbonInterface;
use Danielgnh\Footprint\Builders\FootprintBuilder;
use Danielgnh\Footprint\Models\Footprint;
use Illuminate\Database\Query\Builder as Query;
use Illuminate\Support\Collection;

/**
 * Every page over a range with the shares that point at trouble. Grouped in
 * SQL, so it stays cheap on a whole site; medians belong to one page.
 */
final class SiteInteractions
{
    public function __construct(
        private readonly CarbonInterface $from,
        private readonly CarbonInterface $to,
        private readonly ?string $device = null,
    ) {}

    public function pages(int $minViews = Change::MIN_VIEWS): Collection
    {
        $frustrated = $this->viewsWith('rage', 'dead');
        $abandoned = $this->viewsWith('abandon');

        $scrolled = $this->query()
            ->fromSub($this->events()->deepestScroll()->addSelect('host', 'path')->groupBy('host', 'path')->toBase(), 'views')
            ->select('host', 'path')
            ->selectRaw('sum(case when depth >= 100 then 1 else 0 end) as scrolled_all')
            ->groupBy('host', 'path')
            ->get()
            ->keyBy(fn (object $row): string => $row->host.$row->path);

        return $this->events()
            ->ofType('view')
            ->select('host', 'path')
            ->selectRaw('count(*) as views, count(distinct visit_id) as visits')
            ->groupBy('host', 'path')
            ->havingRaw('count(*) >= ?', [$minViews])
            ->toBase()
            ->get()
            ->map(function (object $page) use ($frustrated, $abandoned, $scrolled): array {
                $key = $page->host.$page->path;
                $views = (int) $page->views;

                return [
                    'host' => $page->host,
                    'path' => $page->path,
                    'views' => $views,
                    'visits' => (int) $page->visits,
                    'scrolled_all' => self::share((int) data_get($scrolled->get($key), 'scrolled_all', 0), $views),
                    'frustrated' => self::share((int) data_get($frustrated->get($key), 'views', 0), $views),
                    'abandoned' => self::share((int) data_get($abandoned->get($key), 'views', 0), $views),
                ];
            })
            ->values();
    }

    /**
     * Views per page with at least one event of the types: a view with 300
     * rage clicks counts once.
     */
    private function viewsWith(string ...$types): Collection
    {
        return $this->query()
            ->fromSub($this->events()->ofType(...$types)->perView('host', 'path')->toBase(), 'per_view')
            ->select('host', 'path')
            ->selectRaw('count(*) as views')
            ->groupBy('host', 'path')
            ->get()
            ->keyBy(fn (object $row): string => $row->host.$row->path);
    }

    private static function share(int $count, int $views): float
    {
        return round(min(1, $count / max(1, $views)), 3);
    }

    private function events(): FootprintBuilder
    {
        return Footprint::query()
            ->between($this->from, $this->to)
            ->when($this->device, fn (FootprintBuilder $events, string $device) => $events->onDevice($device));
    }

    private function query(): Query
    {
        return (new Footprint)->getConnection()->query();
    }
}
```

## Names the site wrote

```php
<?php

namespace App\Footprint;

use Danielgnh\Footprint\Ingest\PathNormalizer;
use Danielgnh\Footprint\Ingest\Scrubber;
use DOMDocument;
use DOMElement;
use DOMXPath;

/**
 * The names a page contains, read the way the tracker reads them: each
 * element's textContent and naming attributes, link targets and form
 * actions, scrubbed by the same Scrubber at the tracker's cut (60) and the
 * server's (100). A section, element, field or form name from Footprint is
 * shown to an agent only when it is in here. A name the page renders some
 * other way, say from JavaScript, misses and stays hidden; a forged one
 * cannot get in.
 */
final class Vocabulary
{
    private const ATTRIBUTES = ['data-footprint', 'data-footprint-section', 'aria-label', 'alt', 'title', 'name', 'id'];

    /**
     * @param  array<string, true>  $names
     */
    private function __construct(private readonly array $names) {}

    /**
     * @param  list<string>  $events  custom event names the site sends with footprint.track()
     */
    public static function fromHtml(string $html, array $events = []): self
    {
        $names = array_fill_keys($events, true);

        if (blank($html)) {
            return new self($names);
        }

        $document = new DOMDocument;
        $errors = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8">'.$html, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($errors);

        $xpath = new DOMXPath($document);

        foreach ($xpath->query('//*[@data-footprint-ignore] | //script | //style') ?: [] as $node) {
            $node->parentNode?->removeChild($node);
        }

        $paths = app(PathNormalizer::class);
        $add = function (?string $value) use (&$names): void {
            foreach ([60, 100] as $cut) {
                if (($name = Scrubber::text($value, $cut)) !== null) {
                    $names[$name] = true;
                }
            }
        };

        foreach ($xpath->query('//*') ?: [] as $element) {
            if (! $element instanceof DOMElement) {
                continue;
            }

            $names[$element->localName] = true;
            $add($element->textContent);

            foreach (self::ATTRIBUTES as $attribute) {
                $add($element->getAttribute($attribute));
            }

            foreach (['href', 'action'] as $attribute) {
                foreach (self::link($element->getAttribute($attribute), $paths) as $link) {
                    $names[$link] = true;
                }
            }
        }

        return new self($names);
    }

    /**
     * True when every name given is on the page. Null is no name, such as a
     * click outside any section, and passes.
     */
    public function allows(?string ...$names): bool
    {
        foreach ($names as $name) {
            if ($name !== null && ! isset($this->names[$name])) {
                return false;
            }
        }

        return true;
    }

    /**
     * A link the way ingest stores it: a path, a host, a fragment or a bare
     * mailto:, tel: or sms:. An absolute URL gives its host and its path, as
     * the tracker stores a same-site link by its path.
     *
     * @return list<string>
     */
    private static function link(string $href, PathNormalizer $paths): array
    {
        if (str_starts_with($href, '#')) {
            $fragment = Scrubber::text(substr($href, 1), 100);

            return $fragment === null ? [] : ["#{$fragment}"];
        }

        if (preg_match('/^(mailto|tel|sms):/i', $href, $scheme) === 1) {
            return [strtolower($scheme[1]).':'];
        }

        $host = parse_url($href, PHP_URL_HOST);

        if (! is_string($host)) {
            return str_starts_with($href, '/') ? array_values(array_filter([$paths->normalize($href)])) : [];
        }

        return array_values(array_filter([strtolower($host), $paths->normalize(parse_url($href, PHP_URL_PATH) ?: '/')]));
    }
}
```

## Rows an agent may see

```php
<?php

namespace App\Footprint;

use Closure;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;

/**
 * Named rows for an agent: the $limit largest that cover at least MIN_GROUP
 * views and pass $allowed, usually Vocabulary::allows(). The rest are summed
 * into one `other` row, so no row stands for a handful of visitors and no
 * forged name gets through. Only the columns in $keep leave, besides `views`.
 */
final class Chunks
{
    public const MIN_GROUP = 10;

    /**
     * @param  iterable<array<string, mixed>|object>  $rows  each with `views`, the views it covers
     * @param  Closure(array<string, mixed>): bool  $allowed
     * @param  list<string>  $keep
     * @return Collection<int, array<string, mixed>>
     */
    public static function fold(iterable $rows, Closure $allowed, array $keep, int $limit = 15, int $min = self::MIN_GROUP): Collection
    {
        [$named, $hidden] = collect($rows)
            ->map(fn (array|object $row): array => (array) $row)
            ->sortByDesc(fn (array $row): int => (int) $row['views'])
            ->partition(fn (array $row): bool => (int) $row['views'] >= $min && $allowed($row));

        $shown = $named
            ->take($limit)
            ->map(fn (array $row): array => [...Arr::only($row, $keep), 'views' => (int) $row['views']])
            ->values();

        $other = (int) $hidden->sum('views') + (int) $named->skip($limit)->sum('views');

        return $other === 0 ? $shown : $shown->push(['other' => true, 'views' => $other]);
    }
}
```

`other` sums the rows it folds, so a view that appears in two of them counts twice there. It says how much is hidden, not how many visitors.

## What an agent may see of a page

```php
<?php

namespace App\Footprint;

use Closure;
use Illuminate\Support\Collection;

/**
 * One page as an agent may see it: PageInteractions' numbers with one vote
 * per view, every name checked against the page's Vocabulary, every list
 * folded through Chunks, and nothing but counts under MIN_VIEWS views. The
 * MCP tools only shape what this returns.
 */
final class Evidence
{
    private ?array $figures = null;

    public function __construct(
        private readonly PageInteractions $page,
        private readonly Vocabulary $vocabulary,
    ) {}

    /**
     * Shares and medians need MIN_VIEWS views. Under that, every method
     * returns counts or nothing.
     */
    public function readable(): bool
    {
        return $this->views() >= Change::MIN_VIEWS;
    }

    public function figures(): array
    {
        $figures = $this->raw();

        if (! $this->readable()) {
            return ['views' => $figures['views'], 'visits' => $figures['visits']];
        }

        return [
            'views' => $figures['views'],
            'visits' => $figures['visits'],
            'median_time_ms' => $figures['median_time_ms'],
            'scrolled_half' => $figures['scrolled_half'],
            'scrolled_all' => $figures['scrolled_all'],
            'rage' => $this->page->share('rage'),
            'dead' => $this->page->share('dead'),
            'abandoned' => $this->page->share('abandon'),
        ];
    }

    /**
     * Share of views whose deepest point reached each 10% step.
     *
     * @return array<int, float>|null
     */
    public function scroll(): ?array
    {
        return $this->readable() ? $this->page->scroll() : null;
    }

    /**
     * @param  array<string, array{field: string, index: int, type: string}>  $blocks  from Blocks::map()
     */
    public function sections(array $blocks = []): Collection
    {
        if (! $this->readable()) {
            return collect();
        }

        $sections = $this->page->sections()->filter(fn (array $section): bool => $this->vocabulary->allows($section['section']))->values();

        return $sections->map(fn (array $section, int $i): array => [
            'section' => $section['section'],
            'reach' => $section['reach'],
            'drop' => $i === 0 ? null : round($sections[$i - 1]['reach'] - $section['reach'], 3),
            'median_ms' => $section['views'] >= Change::MIN_VIEWS ? $section['median_ms'] : null,
            'block' => $blocks[$section['section']] ?? null,
        ]);
    }

    public function clicks(): Collection
    {
        return $this->fold(
            $this->page->clicks(200),
            fn (array $click): bool => $this->vocabulary->allows($click['target'], $click['section'], $click['href']),
            ['target', 'section', 'href'],
        );
    }

    public function frustration(): Collection
    {
        return $this->fold(
            $this->page->frustration(200),
            fn (array $row): bool => $this->vocabulary->allows($row['target'], $row['section']),
            ['type', 'target', 'section'],
        );
    }

    public function forms(): Collection
    {
        if (! $this->readable()) {
            return collect();
        }

        return $this->page->forms()
            ->filter(fn (array $form): bool => $this->vocabulary->allows($form['form']))
            ->map(fn (array $form): array => [
                'form' => $form['form'],
                'submitted' => $this->share($form['submitted_views']),
                'fields' => $this->fold(
                    collect($form['fields'])->map(fn (array $field): array => [...$field, 'left_here' => $this->share($field['abandoned'])]),
                    fn (array $field): bool => $this->vocabulary->allows($field['field']),
                    ['field', 'left_here'],
                ),
            ])
            ->values();
    }

    public function custom(): Collection
    {
        return $this->fold($this->page->custom(), fn (array $event): bool => $this->vocabulary->allows($event['name']), ['name']);
    }

    /**
     * @param  Closure(string): bool  $isPage  whether the agent may see a path, e.g. it is an entry
     * @return array{previous: Collection, next: Collection}
     */
    public function flows(Closure $isPage): array
    {
        if (! $this->readable()) {
            return ['previous' => collect(), 'next' => collect()];
        }

        $flows = $this->page->flows();

        return [
            'previous' => $this->fold($flows['previous'], fn (array $row): bool => $row['previous'] === null || $isPage($row['previous']), ['previous']),
            'next' => $this->fold($flows['next'], fn (array $row): bool => $isPage($row['path']), ['path']),
        ];
    }

    /**
     * What views did after a signal. Null when the name is not on the page;
     * only the count when fewer than MIN_GROUP views had the signal.
     *
     * @param  Closure(string): bool  $isPage
     */
    public function after(string $type, ?string $name, Closure $isPage): ?array
    {
        if (! $this->vocabulary->allows($name)) {
            return null;
        }

        $after = Sequences::after($this->page->events(), $type, $name);

        if ($after['views'] < Chunks::MIN_GROUP) {
            return ['views' => $after['views']];
        }

        return [
            'views' => $after['views'],
            'next' => Chunks::fold($after['next'], fn (array $row): bool => $this->vocabulary->allows($row['target'], $row['section']), ['type', 'target', 'section']),
            'nothing_next' => $after['nothing_next'],
            'ended' => $after['ended'],
            'moved_to' => Chunks::fold($after['moved_to'], fn (array $row): bool => $isPage($row['path']), ['path']),
            'median_seconds_to_next' => $after['median_seconds_to_next'],
        ];
    }

    /**
     * One metric as a share of views, for Change::share(): scrolled_half,
     * scrolled_all, rage, dead, abandon, or a name after a colon:
     * submit:<form>, custom:<event>, click:<element>, reach:<section>. Null
     * under MIN_VIEWS views, and when the page does not have it, such as a
     * section the change removed.
     */
    public function measure(string $metric): ?float
    {
        [$kind, $name] = array_pad(explode(':', $metric, 2), 2, null);

        if (! $this->readable() || ! $this->vocabulary->allows($name)) {
            return null;
        }

        return match (true) {
            in_array($kind, ['scrolled_half', 'scrolled_all'], true) && $name === null => $this->raw()[$kind],
            in_array($kind, ['rage', 'dead', 'abandon'], true) && $name === null => $this->page->share($kind),
            in_array($kind, ['submit', 'custom', 'click'], true) && filled($name) => $this->page->share($kind, $name),
            $kind === 'reach' && filled($name) => data_get($this->page->sections()->firstWhere('section', $name), 'reach'),
            default => null,
        };
    }

    /**
     * @param  list<string>  $keep
     */
    private function fold(Collection $rows, Closure $allowed, array $keep): Collection
    {
        if (! $this->readable()) {
            return collect();
        }

        return Chunks::fold($rows, $allowed, $keep)
            ->map(fn (array $row): array => data_get($row, 'other') ? $row : [...$row, 'share' => $this->share($row['views'])]);
    }

    private function share(int $views): float
    {
        return round(min(1, $views / max(1, $this->views())), 3);
    }

    private function raw(): array
    {
        return $this->figures ??= $this->page->figures();
    }

    private function views(): int
    {
        return $this->raw()['views'];
    }
}
```

- `share` on a named row is its views over the page's views, 0 to 1, like every share the agent sees. The `other` row has no share: it can count a view twice.
- `measure()` is what `interactions_compare` tests and what `interactions_get` reports for a goal: `submit:quote` is the share of views that sent the quote form.

## What views did after a signal

```php
<?php

namespace App\Footprint;

use Danielgnh\Footprint\Builders\FootprintBuilder;
use Danielgnh\Footprint\Models\Footprint;
use Illuminate\Support\Collection;

/**
 * What views did after a signal, such as a dead click on one element: the
 * next thing they did on the page, how long it took, and how the view ended.
 * Read from the newest views with the signal and returned as counts of
 * views, so no single visit, id or clock time comes out.
 */
final class Sequences
{
    private const SKIP = ['dwell', 'scroll', 'section', 'view'];

    /**
     * @param  FootprintBuilder  $events  a fresh query for the page's events, narrowed to a range and device
     * @return array{views: int, next: Collection<int, array{type: string, target: ?string, section: ?string, views: int}>, nothing_next: int, ended: array{submitted: int, moved: int, left: int}, moved_to: Collection<int, array{path: string, views: int}>, median_seconds_to_next: ?float}
     */
    public static function after(FootprintBuilder $events, string $type, ?string $name = null, int $limit = 500): array
    {
        $signals = $events
            ->ofType($type)
            ->when($name !== null, fn (FootprintBuilder $events) => $events->where($type === 'submit' ? 'form' : 'target', $name))
            ->perView()
            ->selectRaw('min(t) as t, max(id) as latest')
            ->reorder()
            ->orderByDesc('latest')
            ->limit($limit)
            ->toBase()
            ->get();

        $timelines = Footprint::query()
            ->whereIn('visit_id', $signals->pluck('visit_id')->unique())
            ->timeline()
            ->get(['visit_id', 'view', 't', 'path', 'type', 'target', 'section', 'form'])
            ->groupBy(fn (Footprint $event): string => $event->visit_id.':'.$event->view);

        $followed = $signals->map(function (object $signal) use ($timelines, $type, $name): array {
            $view = $timelines->get($signal->visit_id.':'.$signal->view, collect());
            $next = $view->first(fn (Footprint $event): bool => $event->t >= $signal->t
                && ! in_array($event->type, self::SKIP, true)
                && ! ($event->type === $type && ($name === null || ($event->type === 'submit' ? $event->form : $event->target) === $name)));
            $following = $timelines->get($signal->visit_id.':'.($signal->view + 1))?->firstWhere('type', 'view');

            return [
                'next' => $next === null ? null : [
                    'type' => $next->type,
                    'target' => $next->type === 'submit' ? $next->form : $next->target,
                    'section' => $next->section,
                ],
                'seconds' => $next === null ? null : ($next->t - (int) $signal->t) / 1000,
                'ended' => match (true) {
                    $view->contains(fn (Footprint $event): bool => $event->type === 'submit' && $event->t >= $signal->t) => 'submitted',
                    $following !== null => 'moved',
                    default => 'left',
                },
                'moved_to' => $following?->path,
            ];
        });

        $seconds = $followed->pluck('seconds')->filter(fn (?float $seconds): bool => $seconds !== null);

        return [
            'views' => $followed->count(),
            'next' => self::count($followed->pluck('next')->filter()),
            'nothing_next' => $followed->whereNull('next')->count(),
            'ended' => [
                'submitted' => $followed->where('ended', 'submitted')->count(),
                'moved' => $followed->where('ended', 'moved')->count(),
                'left' => $followed->where('ended', 'left')->count(),
            ],
            'moved_to' => self::count($followed->pluck('moved_to')->filter()->map(fn (string $path): array => ['path' => $path])),
            'median_seconds_to_next' => $seconds->count() >= Change::MIN_VIEWS ? round((float) $seconds->median(), 1) : null,
        ];
    }

    /**
     * @param  Collection<int, array<string, ?string>>  $rows
     * @return Collection<int, array<string, mixed>>
     */
    private static function count(Collection $rows): Collection
    {
        return $rows
            ->groupBy(fn (array $row): string => implode("\0", array_map(strval(...), $row)))
            ->map(fn (Collection $group): array => [...$group->first(), 'views' => $group->count()])
            ->sortByDesc('views')
            ->values();
    }
}
```

- A view counts once however often the signal fired in it. The next action skips repeats of the signal itself, so the answer to "what did they do after the third rage click on Pay" is not "rage-clicked Pay".
- `nothing_next` are views that did nothing else on the page after the signal. With `ended.left` it reads as giving up.
- The tool folds `next` and `moved_to` through `Chunks`, and `moved_to` only keeps paths that are entries.

## Sections to page builder blocks

```php
<?php

namespace App\Footprint;

use Illuminate\Support\Str;

/**
 * Where each tracked section lives in the entry. Templates name a section
 * after its set handle, slugged, and number a set that repeats on the page:
 * `hero`, `faq`, `faq-2`. Disabled sets are not rendered, so they are not
 * counted.
 */
final class Blocks
{
    /**
     * @param  list<array{field: string, type: string, value: mixed}>  $fields  the entry's Replicator and Bard fields in page order, with raw values
     * @return array<string, array{field: string, index: int, type: string}>
     */
    public static function map(array $fields): array
    {
        $blocks = [];
        $seen = [];

        foreach ($fields as $field) {
            foreach (array_values(is_array($field['value']) ? $field['value'] : []) as $index => $node) {
                $set = $field['type'] === 'bard' ? data_get($node, 'attrs.values') : $node;
                $enabled = $field['type'] === 'bard' ? data_get($node, 'attrs.enabled', true) : data_get($node, 'enabled', true);
                $type = data_get($set, 'type');

                if (($field['type'] === 'bard' && data_get($node, 'type') !== 'set') || ! is_string($type) || $enabled === false) {
                    continue;
                }

                $name = Str::slug($type);
                $seen[$name] = ($seen[$name] ?? 0) + 1;

                $blocks[$seen[$name] === 1 ? $name : "{$name}-{$seen[$name]}"] = ['field' => $field['field'], 'index' => $index, 'type' => $type];
            }
        }

        return $blocks;
    }
}
```

## Before and after a change

```php
<?php

namespace App\Footprint;

/**
 * One share before and after a change, flagged as noise when either side
 * has under MIN_VIEWS views or the difference is inside two standard errors.
 * A compare tests the one metric its hypothesis named: testing every number
 * on a page at once would turn up a "result" most of the time by chance.
 */
final class Change
{
    public const MIN_VIEWS = 30;

    /**
     * A share of views, 0 to 1. Null on a side where the thing did not
     * exist, such as a section added by the change.
     *
     * @return array{before: ?float, after: ?float, change: ?float, noise: ?bool}
     */
    public static function share(?float $before, int $beforeViews, ?float $after, int $afterViews): array
    {
        if ($before === null || $after === null) {
            return ['before' => $before, 'after' => $after, 'change' => null, 'noise' => null];
        }

        $pooled = ($before * $beforeViews + $after * $afterViews) / max(1, $beforeViews + $afterViews);
        $error = sqrt($pooled * (1 - $pooled) * (1 / max(1, $beforeViews) + 1 / max(1, $afterViews)));

        return [
            'before' => round($before, 3),
            'after' => round($after, 3),
            'change' => round($after - $before, 3),
            'noise' => min($beforeViews, $afterViews) < self::MIN_VIEWS || abs($after - $before) <= 2 * $error,
        ];
    }
}
```
