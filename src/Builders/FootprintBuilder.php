<?php

namespace Danielgnh\Footprint\Builders;

use Danielgnh\Footprint\Builders\Concerns\MatchesPages;
use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * @extends Builder<Footprint>
 */
class FootprintBuilder extends Builder
{
    use MatchesPages;

    public function onPage(string $url): static
    {
        return $this->matchingPage('path', $url);
    }

    /**
     * Rows that arrived from $from up to, not including, $to.
     */
    public function between(DateTimeInterface $from, DateTimeInterface $to): static
    {
        return $this
            ->where($this->qualifyColumn('created_at'), '>=', $from)
            ->where($this->qualifyColumn('created_at'), '<', $to);
    }

    public function onDevice(string $device): static
    {
        return $this->whereIn($this->qualifyColumn('visit_id'), Visit::query()->select('id')->where('device', $device));
    }

    public function ofType(string ...$types): static
    {
        return $this->whereIn($this->qualifyColumn('type'), $types);
    }

    public function inSection(string $section): static
    {
        return $this->where($this->qualifyColumn('section'), $section);
    }

    /**
     * One row per view and section with `ms`, the time it was on screen.
     * Dwell rows are deltas sent on every flush, so they only mean something
     * summed. A null section is time on the page.
     */
    public function dwellPerView(): static
    {
        return $this->ofType('dwell')
            ->select($this->qualifyColumns(['section', 'visit_id', 'view']))
            ->selectRaw('sum(value) as ms')
            ->groupBy($this->qualifyColumns(['section', 'visit_id', 'view']))
            ->withCasts(['ms' => 'integer']);
    }

    /**
     * One row per view with `depth`, the deepest scroll in percent. A view
     * without a row never passed 10%.
     */
    public function deepestScroll(): static
    {
        return $this->ofType('scroll')
            ->select($this->qualifyColumns(['visit_id', 'view']))
            ->selectRaw('max(value) as depth')
            ->groupBy($this->qualifyColumns(['visit_id', 'view']))
            ->withCasts(['depth' => 'integer']);
    }

    /**
     * One row per view and section it reached, with the section's `position`
     * among the page's tracked sections.
     */
    public function reachedSections(): static
    {
        return $this->ofType('section')
            ->select($this->qualifyColumns(['section', 'visit_id', 'view']))
            ->selectRaw('min(section_index) as position')
            ->groupBy($this->qualifyColumns(['section', 'visit_id', 'view']))
            ->withCasts(['position' => 'integer']);
    }

    /**
     * One row per view and value of the given columns, however many events
     * the view had. Count these rows to give every view one vote: a view with
     * 300 rage clicks counts once.
     */
    public function perView(string ...$columns): static
    {
        $columns = $this->qualifyColumns(['visit_id', 'view', ...$columns]);

        return $this->select($columns)->groupBy($columns);
    }

    /**
     * Events in the order they happened. Dwell is left out: its `t` is when a
     * flush sent it, not when the section was on screen.
     */
    public function timeline(): static
    {
        return $this->whereNot($this->qualifyColumn('type'), 'dwell')
            ->orderBy($this->qualifyColumn('view'))
            ->orderBy($this->qualifyColumn('t'))
            ->orderBy($this->qualifyColumn('id'));
    }
}
