<?php

use App\Footprint\PageInteractions;
use Danielgnh\Footprint\Models\Visit;

/**
 * The Statamic Interactions skill tells agents to copy the PageInteractions
 * class from its references/queries.md. This runs that exact code against
 * batches real browsers sent, so the documented queries keep matching the
 * schema.
 */
beforeEach(function () {
    if (! class_exists(PageInteractions::class)) {
        $markdown = (string) file_get_contents(__DIR__.'/../../resources/boost/skills/footprint-statamic-interactions/references/queries.md');
        preg_match('/```php\n(.*?)```/s', $markdown, $match);

        $file = tempnam(sys_get_temp_dir(), 'interactions').'.php';
        file_put_contents($file, $match[1]);
        require $file;
    }

    config(['footprint.rate_limit' => 10_000]);

    foreach (glob(__DIR__.'/../../contract/fixtures/chromium/*.json') ?: [] as $recording) {
        foreach (json_decode((string) file_get_contents($recording), true) as $batch) {
            ingest($batch)->assertNoContent();
        }
    }
});

function interactions(string $path, ?string $device = null): PageInteractions
{
    return new PageInteractions('http://localhost'.$path, now()->subDay(), now()->addMinute(), $device);
}

it('counts the figures of a page', function () {
    $figures = interactions('/long')->figures();

    expect($figures['views'])->toBeGreaterThan(0)
        ->and($figures['visits'])->toBeGreaterThan(0)
        ->and($figures['visits'])->toBeLessThanOrEqual($figures['views'])
        ->and($figures['median_time_ms'])->toBeGreaterThan(0)
        ->and($figures['scrolled_all'])->toBeGreaterThan(0)->toBeLessThanOrEqual(1);
});

it('orders sections down the page with their reach and dwell', function () {
    $sections = interactions('/long')->sections();
    $marked = $sections->pluck('section')->filter(fn (string $name) => preg_match('/^s\d$/', $name) === 1)->values()->all();

    expect($marked)->toBe(['s1', 's2', 's3', 's4', 's5', 's6'])
        ->and($sections->firstWhere('section', 's1')['reach'])->toBeGreaterThan(0)->toBeLessThanOrEqual(1)
        ->and($sections->firstWhere('section', 's3')['median_ms'])->toBeGreaterThan(0);
});

it('ranks clicks and gives each a share of visits', function () {
    $clicks = interactions('/clicks')->clicks();

    expect($clicks->pluck('target'))->toContain('Build yours', 'Pay', 'The bike')
        ->and($clicks->firstWhere('target', 'The bike')['href'])->toBe('/bikes/gravel')
        ->and($clicks->every(fn (array $click) => $click['share'] > 0 && $click['share'] <= 1))->toBeTrue();
});

it('lists frustration and only draws points for one device', function () {
    $report = interactions('/clicks', 'desktop');

    expect($report->frustration()->pluck('type')->unique()->sort()->values()->all())->toBe(['dead', 'rage'])
        ->and($report->points())->not->toBeEmpty()
        ->and($report->points()->every(fn (object $point) => $point->x >= 0 && $point->x <= 1))->toBeTrue()
        ->and(interactions('/clicks', 'tablet')->points())->toBeEmpty();
});

it('shows which fields were focused and where the form was given up', function () {
    $quote = interactions('/forms')->forms()->firstWhere('form', 'quote');

    expect(collect($quote['fields'])->pluck('field')->all())->toContain('email', 'name', 'notes', 'password')
        ->and(collect($quote['fields'])->firstWhere('field', 'password')['abandoned'])->toBeGreaterThan(0)
        ->and(interactions('/forms')->forms()->firstWhere('form', 'Newsletter')['submitted'])->toBeGreaterThan(0);
});

it('follows views in and out of a page', function () {
    $flows = interactions('/spa/b')->flows();

    expect(collect($flows['previous'])->pluck('previous'))->toContain('/spa')
        ->and(collect($flows['next'])->pluck('path'))->toContain('/spa');
});

it('gives every view one vote in shares and per-view columns', function () {
    $clicks = interactions('/clicks');
    $forms = interactions('/forms');
    $quote = $forms->forms()->firstWhere('form', 'quote');

    expect($clicks->share('rage'))->toBeGreaterThan(0)->toBeLessThanOrEqual(1)
        ->and($clicks->share('dead'))->toBeGreaterThan(0)->toBeLessThanOrEqual(1)
        ->and($clicks->share('click', 'The bike'))->toBeGreaterThan(0)->toBeLessThanOrEqual($clicks->share('click'))
        ->and($clicks->share('rage', 'Nothing called this'))->toBe(0.0)
        ->and($forms->share('submit', 'Newsletter'))->toBeGreaterThan(0)
        ->and($forms->share('abandon'))->toBeGreaterThan(0)
        ->and($clicks->clicks()->every(fn (array $click) => $click['views'] >= $click['visits'] && $click['views'] <= $click['clicks']))->toBeTrue()
        ->and($clicks->frustration()->every(fn (array $row) => $row['views'] >= 1 && $row['views'] <= $row['count']))->toBeTrue()
        ->and(collect($quote['fields'])->every(fn (array $field) => $field['views'] >= 1 && $field['views'] <= $field['focused']))->toBeTrue()
        ->and($forms->forms()->firstWhere('form', 'Newsletter')['submitted_views'])->toBeGreaterThan(0);
});

it('counts a view that hammers a button once', function () {
    $pay = fn () => interactions('/clicks')->frustration()->first(fn (array $row) => $row['type'] === 'rage' && $row['target'] === 'Hammered');

    ingest(batch([
        footprint('view', ['path' => '/clicks', 'from' => null]),
        ...array_fill(0, 100, footprint('rage', ['path' => '/clicks', 'target' => 'Hammered', 'section' => 'checkout', 'x' => 0.5, 'y' => 0.5])),
    ]))->assertNoContent();

    expect($pay()['count'])->toBe(100)
        ->and($pay()['views'])->toBe(1);
});

it('lists recent visits and replays one without dwell rows', function () {
    $visits = interactions('/long')->visits();
    $visit = PageInteractions::visit($visits->first()->id);

    expect($visits)->not->toBeEmpty()
        ->and($visit['visit'])->toBeInstanceOf(Visit::class)
        ->and($visit['events']->pluck('type'))->not->toContain('dwell')
        ->and($visit['events']->first()->type)->toBe('view');
});
