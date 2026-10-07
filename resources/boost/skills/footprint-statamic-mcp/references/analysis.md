# Analysis classes for the MCP tools

Four small classes the tools lean on. None of them knows about Statamic or MCP: they take Footprint rows or plain arrays and return plain arrays, so they are unit-testable on their own. Per-page numbers come from `App\Footprint\PageInteractions`, shared with the Interactions tab (step 2 of `SKILL.md`).

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
 * Every page over a range with the counts that point at trouble. Grouped
 * in SQL, so it stays cheap on a whole site; medians belong to one page.
 */
final class SiteInteractions
{
    public function __construct(
        private readonly CarbonInterface $from,
        private readonly CarbonInterface $to,
        private readonly ?string $device = null,
    ) {}

    public function pages(int $minViews = 30): Collection
    {
        $friction = $this->events()
            ->ofType('rage', 'dead', 'abandon')
            ->select('host', 'path', 'type')
            ->selectRaw('count(*) as count')
            ->groupBy('host', 'path', 'type')
            ->toBase()
            ->get()
            ->groupBy(fn (object $row): string => $row->host.$row->path);

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
            ->map(function (object $page) use ($friction, $scrolled): array {
                $key = $page->host.$page->path;
                $counts = collect($friction->get($key))->pluck('count', 'type');
                $views = (int) $page->views;

                return [
                    'host' => $page->host,
                    'path' => $page->path,
                    'views' => $views,
                    'visits' => (int) $page->visits,
                    'scrolled_all' => round((int) data_get($scrolled->get($key), 'scrolled_all', 0) / $views, 3),
                    'frustration_per_100' => round(((int) ($counts['rage'] ?? 0) + (int) ($counts['dead'] ?? 0)) / $views * 100, 1),
                    'abandons_per_100' => round((int) ($counts['abandon'] ?? 0) / $views * 100, 1),
                ];
            })
            ->values();
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

## A visit as lines

```php
<?php

namespace App\Footprint;

use Danielgnh\Footprint\Models\Footprint;

/**
 * A visit as short lines an agent reads in one pass: seconds since the
 * visit started, then what happened. There is no id and no clock time, so
 * a visit cannot be matched to a form submission or a log line.
 */
final class Journey
{
    public const LINES = 60;

    /**
     * @param  iterable<Footprint>  $events  in timeline() order
     * @return list<string>
     */
    public static function lines(iterable $events): array
    {
        $lines = collect($events)->map(fn (Footprint $event): string => sprintf('+%.1fs %s', $event->t / 1000, self::describe($event)));

        if ($lines->count() <= self::LINES) {
            return $lines->values()->all();
        }

        return [...$lines->take(self::LINES)->all(), sprintf('… %d more', $lines->count() - self::LINES)];
    }

    private static function describe(Footprint $event): string
    {
        $in = $event->section === null ? '' : " in {$event->section}";

        return match ($event->type) {
            'view' => "view {$event->path}".($event->previous === null ? '' : " from {$event->previous}"),
            'section' => "reached {$event->section}",
            'scroll' => "scrolled to {$event->value}%",
            'click' => "click \"{$event->target}\"{$in}".($event->href === null ? '' : " → {$event->href}"),
            'rage' => "rage click \"{$event->target}\"{$in}",
            'dead' => "dead click \"{$event->target}\"{$in}",
            'field' => "focused {$event->target}".($event->form === null ? '' : " in {$event->form}"),
            'submit' => 'submitted '.($event->form ?? 'a form'),
            'abandon' => 'left '.($event->form ?? 'a form')." at {$event->target}",
            'custom' => "{$event->target} ".json_encode($event->data ?? (object) []),
            default => $event->type,
        };
    }
}
```

## Before and after a change

```php
<?php

namespace App\Footprint;

/**
 * A metric before and after a change, flagged as noise when either side
 * has under 30 views or the difference is inside two standard errors. The
 * flag keeps an agent from reading a win into a handful of visits.
 */
final class Change
{
    public const MIN_VIEWS = 30;

    /**
     * A share of views (or visits), 0 to 1. Null on a side where the thing
     * did not exist, such as a section added by the change.
     */
    public static function share(?float $before, int $beforeViews, ?float $after, int $afterViews): array
    {
        if ($before === null || $after === null) {
            return ['before' => $before, 'after' => $after, 'change' => null, 'noise' => null];
        }

        $pooled = ($before * $beforeViews + $after * $afterViews) / max(1, $beforeViews + $afterViews);
        $error = sqrt($pooled * (1 - $pooled) * (1 / max(1, $beforeViews) + 1 / max(1, $afterViews)));

        return self::compared($before, $beforeViews, $after, $afterViews, $error);
    }

    /**
     * A count per view, such as rage clicks per view, which can exceed 1.
     */
    public static function rate(float $before, int $beforeViews, float $after, int $afterViews): array
    {
        $error = sqrt($before / max(1, $beforeViews) + $after / max(1, $afterViews));

        return self::compared($before, $beforeViews, $after, $afterViews, $error);
    }

    /**
     * A median, such as time on page. Only the sample size is checked.
     */
    public static function median(int $before, int $beforeViews, int $after, int $afterViews): array
    {
        return [
            'before' => $before,
            'after' => $after,
            'change' => $after - $before,
            'noise' => min($beforeViews, $afterViews) < self::MIN_VIEWS,
        ];
    }

    private static function compared(float $before, int $beforeViews, float $after, int $afterViews, float $error): array
    {
        return [
            'before' => round($before, 3),
            'after' => round($after, 3),
            'change' => round($after - $before, 3),
            'noise' => min($beforeViews, $afterViews) < self::MIN_VIEWS || abs($after - $before) <= 2 * $error,
        ];
    }
}
```
