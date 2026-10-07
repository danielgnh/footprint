<?php

namespace Danielgnh\Footprint\Models;

use Danielgnh\Footprint\Builders\FootprintBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;

/**
 * One recorded interaction. The README's data dictionary says what each
 * column means for each type.
 *
 * @property int $id
 * @property string $visit_id
 * @property int $view
 * @property int $t
 * @property string $host
 * @property string $path
 * @property string $type
 * @property ?string $section
 * @property ?int $section_index
 * @property ?string $target
 * @property ?string $href
 * @property ?string $previous
 * @property ?string $form
 * @property ?float $x
 * @property ?float $y
 * @property ?int $value
 * @property ?array<string, mixed> $data
 * @property Carbon $created_at
 */
class Footprint extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'footprints';

    protected $guarded = [];

    #[\Override]
    public function getConnectionName(): ?string
    {
        return config('footprint.connection');
    }

    /**
     * @return BelongsTo<Visit, $this>
     */
    public function visit(): BelongsTo
    {
        return $this->belongsTo(Visit::class);
    }

    /**
     * @param  Builder  $query
     */
    #[\Override]
    public function newEloquentBuilder($query): FootprintBuilder
    {
        return new FootprintBuilder($query);
    }

    #[\Override]
    protected function casts(): array
    {
        return [
            'view' => 'integer',
            't' => 'integer',
            'section_index' => 'integer',
            'x' => 'float',
            'y' => 'float',
            'value' => 'integer',
            'data' => 'array',
        ];
    }
}
