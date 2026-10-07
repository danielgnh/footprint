<?php

namespace Danielgnh\Footprint\Builders;

use Danielgnh\Footprint\Builders\Concerns\MatchesPages;
use Danielgnh\Footprint\Models\Visit;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * @extends Builder<Visit>
 */
class VisitBuilder extends Builder
{
    use MatchesPages;

    public function landedOn(string $url): static
    {
        return $this->matchingPage('entry_path', $url);
    }

    /**
     * Visits that started from $from up to, not including, $to.
     */
    public function between(DateTimeInterface $from, DateTimeInterface $to): static
    {
        return $this
            ->where($this->qualifyColumn('started_at'), '>=', $from)
            ->where($this->qualifyColumn('started_at'), '<', $to);
    }

    public function onDevice(string $device): static
    {
        return $this->where($this->qualifyColumn('device'), $device);
    }
}
