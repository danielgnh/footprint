# Queries for the Interactions tab

Every number on the tab comes from one class scoped to a page URL, a date range and an optional device. It is built on the query methods of Footprint's models (`onPage`, `between`, `onDevice`, `dwellPerView`, `deepestScroll`, `reachedSections`, `timeline`; the package README lists them), so it reads dwell and scroll the way they were written, follows the package's `connection` setting, and runs on SQLite, MySQL and PostgreSQL alike. Medians are taken in PHP from per-view sums, which stays portable and is fine behind a ten-minute cache. On a site with heavy traffic, move them into a nightly rollup table rather than raising the cache time.

```php
<?php

namespace App\Footprint;

use Carbon\CarbonInterface;
use Danielgnh\Footprint\Builders\FootprintBuilder;
use Danielgnh\Footprint\Builders\VisitBuilder;
use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;
use Illuminate\Database\Query\Builder as Query;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;

final class PageInteractions
{
    public const POINTS = 5000;

    private ?int $views = null;

    private ?Collection $dwell = null;

    public function __construct(
        private readonly string $url,
        private readonly CarbonInterface $from,
        private readonly CarbonInterface $to,
        private readonly ?string $device = null,
    ) {}

    public function figures(): array
    {
        $scroll = $this->scroll();

        return [
            'views' => $this->views(),
            'visits' => $this->visitCount(),
            'median_time_ms' => (int) $this->dwell()->whereNull('section')->median('ms'),
            'scrolled_half' => $scroll[50],
            'scrolled_all' => $scroll[100],
            'rage' => $this->events()->ofType('rage')->count(),
            'dead' => $this->events()->ofType('dead')->count(),
            'abandons' => $this->events()->ofType('abandon')->count(),
        ];
    }

    /**
     * Sections in page order: the share of views that reached each one and
     * the median time it stayed on screen in the views that reached it.
     */
    public function sections(): Collection
    {
        $views = max(1, $this->views());
        $dwell = $this->dwell()->whereNotNull('section')->groupBy('section');

        return $this->query()
            ->fromSub($this->events()->reachedSections()->toBase(), 'reached')
            ->select('section')
            ->selectRaw('count(*) as views, avg(position) as position')
            ->groupBy('section')
            ->get()
            ->map(fn (object $row): array => [
                'section' => $row->section,
                'position' => (float) $row->position,
                'views' => (int) $row->views,
                'reach' => round($row->views / $views, 3),
                'median_ms' => (int) collect($dwell->get($row->section))->median('ms'),
            ])
            ->sortBy('position')
            ->values();
    }

    /**
     * Share of views whose deepest point reached each 10% step.
     *
     * @return array<int, float>
     */
    public function scroll(): array
    {
        $views = max(1, $this->views());
        $depths = $this->events()->deepestScroll()->toBase()->pluck('depth');

        return collect(range(10, 100, 10))
            ->mapWithKeys(fn (int $step): array => [$step => round($depths->filter(fn ($depth) => $depth >= $step)->count() / $views, 3)])
            ->all();
    }

    public function clicks(int $limit = 30): Collection
    {
        $visits = max(1, $this->visitCount());

        return $this->events()
            ->ofType('click')
            ->select('target', 'section', 'href')
            ->selectRaw('count(*) as clicks, count(distinct visit_id) as visits')
            ->groupBy('target', 'section', 'href')
            ->orderByDesc('clicks')
            ->limit($limit)
            ->toBase()
            ->get()
            ->map(fn (object $row): array => [...(array) $row, 'share' => round($row->visits / $visits, 3)]);
    }

    public function frustration(int $limit = 30): Collection
    {
        return $this->events()
            ->ofType('rage', 'dead')
            ->select('type', 'target', 'section')
            ->selectRaw('count(*) as count')
            ->groupBy('type', 'target', 'section')
            ->orderByDesc('count')
            ->limit($limit)
            ->toBase()
            ->get();
    }

    /**
     * Positions for the map. Only meaningful for one device: the caller
     * passes a device or does not ask.
     */
    public function points(): Collection
    {
        return $this->events()
            ->ofType('click', 'rage', 'dead')
            ->whereNotNull('section')
            ->whereNotNull('x')
            ->select('type', 'section', 'target', 'x', 'y')
            ->latest('id')
            ->limit(self::POINTS)
            ->toBase()
            ->get();
    }

    /**
     * Each form's fields: how often they were focused and how often a view
     * ended on them without a submit.
     */
    public function forms(): Collection
    {
        $abandons = $this->countBy('abandon', ['form', 'target']);
        $submits = $this->countBy('submit', ['form'])->pluck('count', 'form');

        return $this->countBy('field', ['form', 'target'])
            ->groupBy(fn (object $row) => $row->form ?? '')
            ->map(fn (Collection $fields, string $form): array => [
                'form' => $form === '' ? null : $form,
                'submitted' => (int) ($submits[$form] ?? 0),
                'fields' => $fields
                    ->map(fn (object $field): array => [
                        'field' => $field->target,
                        'focused' => (int) $field->count,
                        'abandoned' => (int) data_get(
                            $abandons->first(fn (object $abandon) => $abandon->form === $field->form && $abandon->target === $field->target),
                            'count',
                            0,
                        ),
                    ])
                    ->sortByDesc('focused')
                    ->values(),
            ])
            ->values();
    }

    /**
     * Where views of this page came from inside the site, where they went
     * next, and which outside sources started visits here.
     */
    public function flows(): array
    {
        $previous = $this->events()
            ->ofType('view')
            ->select('previous')
            ->selectRaw('count(*) as views')
            ->groupBy('previous')
            ->orderByDesc('views')
            ->limit(10)
            ->toBase()
            ->get();

        $next = $this->events()
            ->ofType('view')
            ->join('footprints as following', function (JoinClause $join): void {
                $join->on('following.visit_id', '=', 'footprints.visit_id')
                    ->on('following.view', '=', $join->raw('footprints.view + 1'))
                    ->where('following.type', '=', 'view');
            })
            ->selectRaw('following.path as path, count(*) as views')
            ->groupBy('following.path')
            ->orderByDesc('views')
            ->limit(10)
            ->toBase()
            ->get();

        $sources = Visit::landedOn($this->url)
            ->between($this->from, $this->to)
            ->when($this->device, fn (VisitBuilder $visits, string $device) => $visits->onDevice($device))
            ->select('referrer_host', 'utm_source', 'utm_campaign')
            ->selectRaw('count(*) as visits')
            ->groupBy('referrer_host', 'utm_source', 'utm_campaign')
            ->orderByDesc('visits')
            ->limit(10)
            ->toBase()
            ->get();

        return ['previous' => $previous, 'next' => $next, 'sources' => $sources];
    }

    /**
     * Custom events sent with footprint.track(), by name.
     */
    public function custom(int $limit = 20): Collection
    {
        return $this->events()
            ->ofType('custom')
            ->select('target as name')
            ->selectRaw('count(*) as count, count(distinct visit_id) as visits')
            ->groupBy('target')
            ->orderByDesc('count')
            ->limit($limit)
            ->toBase()
            ->get();
    }

    public function visits(int $limit = 50): Collection
    {
        return Visit::query()
            ->whereIn('id', $this->events()->ofType('view')->select('visit_id'))
            ->latest('started_at')
            ->limit($limit)
            ->get(['id', 'device', 'viewport', 'lang', 'referrer_host', 'utm_source', 'views', 'started_at', 'ended_at']);
    }

    public static function visit(string $id): array
    {
        $visit = Visit::query()->findOrFail($id, ['id', 'device', 'viewport', 'lang', 'referrer_host', 'started_at', 'ended_at']);

        return [
            'visit' => $visit,
            'events' => $visit->footprints()
                ->timeline()
                ->get(['view', 't', 'path', 'type', 'section', 'target', 'href', 'previous', 'form', 'x', 'y', 'value', 'data']),
        ];
    }

    private function events(): FootprintBuilder
    {
        return Footprint::onPage($this->url)
            ->between($this->from, $this->to)
            ->when($this->device, fn (FootprintBuilder $events, string $device) => $events->onDevice($device));
    }

    private function views(): int
    {
        return $this->views ??= $this->events()->ofType('view')->count();
    }

    private function visitCount(): int
    {
        return $this->events()->ofType('view')->distinct()->count('visit_id');
    }

    /**
     * One row per view and section with `ms` on screen. A null section is
     * time on the page.
     */
    private function dwell(): Collection
    {
        return $this->dwell ??= $this->events()->dwellPerView()->toBase()->get();
    }

    /**
     * @param  list<string>  $columns
     */
    private function countBy(string $type, array $columns): Collection
    {
        return $this->events()
            ->ofType($type)
            ->select($columns)
            ->selectRaw('count(*) as count')
            ->groupBy($columns)
            ->toBase()
            ->get();
    }

    private function query(): Query
    {
        return (new Footprint)->getConnection()->query();
    }
}
```

Notes:

- Pass the entry's full URL, not a path: `onPage()` normalises it the way ingest stored it and also matches the host, so a multisite on several domains keeps its sites apart.
- `footprints.created_at` is when the batch arrived, which is within seconds of the event. Range filters on it are accurate to the day.
- The `(path, type, created_at)` index carries every per-page query. `visits()`, `visit()` and the device filter go through `visit_id`, which is indexed with `view`.
- `section_index` is a section's position among the tracked sections when it was reached, so `avg(position)` orders sections the way the page lays them out even when content loads late.
- `points()` returns the newest points first and stops at `POINTS`. The map needs the shape, not every click.

## The controller

```php
<?php

namespace App\Http\Controllers\CP;

use App\Footprint\PageInteractions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Statamic\Http\Controllers\CP\CpController;

class InteractionsController extends CpController
{
    public function summary(Request $request): array
    {
        $this->authorize('view interactions');
        $input = $this->input($request);

        return Cache::remember('interactions:summary:'.md5(serialize($input)), now()->addMinutes(10), function () use ($input): array {
            $report = $this->report($input);

            return [
                'figures' => $report->figures(),
                'sections' => $report->sections(),
                'scroll' => $report->scroll(),
                'clicks' => $report->clicks(),
                'frustration' => $report->frustration(),
                'forms' => $report->forms(),
                'flows' => $report->flows(),
                'points' => filled($input['device']) ? $report->points() : [],
            ];
        });
    }

    public function visits(Request $request): array
    {
        $this->authorize('view interactions');
        $input = $this->input($request);

        return ['visits' => $this->report($input)->visits()];
    }

    public function visit(string $visit): array
    {
        $this->authorize('view interactions');

        return PageInteractions::visit($visit);
    }

    private function input(Request $request): array
    {
        $data = $request->validate([
            'url' => ['required', 'url', 'max:2048'],
            'days' => ['nullable', 'integer', 'in:7,30,90'],
            'device' => ['nullable', 'in:mobile,tablet,desktop'],
        ]);

        return [
            'url' => data_get($data, 'url'),
            'days' => (int) (data_get($data, 'days') ?? 30),
            'device' => data_get($data, 'device'),
        ];
    }

    private function report(array $input): PageInteractions
    {
        return new PageInteractions(
            url: $input['url'],
            from: now()->subDays($input['days'])->startOfDay(),
            to: now(),
            device: $input['device'],
        );
    }
}
```
