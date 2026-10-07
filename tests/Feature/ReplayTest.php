<?php

use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;
use Illuminate\Support\Facades\DB;

/**
 * Every batch here was sent by a real browser in the Playwright suite
 * (RECORD=1 npx playwright test), so the server is tested against what
 * browsers actually send rather than what we think they send.
 *
 * @return array<string, array{0: string}>
 */
function recordings(): array
{
    $files = glob(__DIR__.'/../../contract/fixtures/*/*.json') ?: [];

    return collect($files)
        ->mapWithKeys(fn (string $file): array => [basename(dirname($file)).'/'.basename($file, '.json') => [$file]])
        ->all();
}

it('stores every event a real browser sent', function (string $file) {
    $batches = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

    foreach ($batches as $batch) {
        ingest($batch)->assertNoContent();
    }

    $sent = collect($batches)->sum(fn (array $batch): int => count($batch['events']));
    $stored = json_encode([DB::table('footprint_visits')->get(), DB::table('footprints')->get()], JSON_THROW_ON_ERROR);

    expect(Footprint::count())->toBe($sent)
        ->and(Visit::sum('events'))->toBe($sent)
        ->and(Visit::count())->toBe(collect($batches)->pluck('visit.id')->unique()->count())
        ->and($stored)->not->toContain('canary')->not->toContain('hunter2')->not->toContain('jane@example.com');
})->with(fn () => recordings());

it('has recordings to replay', function () {
    expect(count(recordings()))->toBeGreaterThan(20);
});
