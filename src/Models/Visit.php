<?php

namespace Danielgnh\Footprint\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One page load's run through the site: a random id that lived only in the
 * browser's memory, with nothing that identifies the person.
 *
 * @property string $id
 * @property string $host
 * @property string $entry_path
 * @property ?string $referrer_host
 * @property ?string $utm_source
 * @property ?string $utm_medium
 * @property ?string $utm_campaign
 * @property ?string $utm_content
 * @property string $device
 * @property int $viewport
 * @property ?string $lang
 * @property int $views
 * @property int $events
 * @property Carbon $started_at
 * @property Carbon $ended_at
 */
class Visit extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $table = 'footprint_visits';

    protected $guarded = [];

    #[\Override]
    public function getConnectionName(): ?string
    {
        return config('footprint.connection');
    }

    /**
     * @return HasMany<Footprint, $this>
     */
    public function footprints(): HasMany
    {
        return $this->hasMany(Footprint::class);
    }

    #[\Override]
    protected function casts(): array
    {
        return [
            'viewport' => 'integer',
            'views' => 'integer',
            'events' => 'integer',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }
}
