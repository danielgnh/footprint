<?php

use App\Footprint\Blocks;
use App\Footprint\Change;
use App\Footprint\Journey;
use App\Footprint\SiteInteractions;
use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;

/**
 * The Statamic MCP skill tells agents to copy these classes from its
 * references/analysis.md. This runs that exact code against batches real
 * browsers sent, so the documented classes keep matching the schema.
 */
beforeEach(function () {
    $markdown = (string) file_get_contents(__DIR__.'/../../resources/boost/skills/footprint-statamic-mcp/references/analysis.md');
    preg_match_all('/```php\n(<\?php.*?)```/s', $markdown, $blocks);

    foreach ($blocks[1] as $code) {
        preg_match('/^final class (\w+)/m', $code, $class);

        if (! class_exists("App\\Footprint\\{$class[1]}")) {
            $file = tempnam(sys_get_temp_dir(), 'skill').'.php';
            file_put_contents($file, $code);
            require $file;
        }
    }

    config(['footprint.rate_limit' => 10_000]);

    foreach (glob(__DIR__.'/../../contract/fixtures/chromium/*.json') ?: [] as $recording) {
        foreach (json_decode((string) file_get_contents($recording), true) as $batch) {
            ingest($batch)->assertNoContent();
        }
    }
});

function site(?string $device = null): SiteInteractions
{
    return new SiteInteractions(now()->subDay(), now()->addMinute(), $device);
}

it('lists every page of the site with what points at trouble', function () {
    $pages = site()->pages(1)->keyBy('path');

    expect($pages->keys())->toContain('/long', '/clicks', '/forms')
        ->and($pages->every(fn (array $page) => $page['host'] === 'localhost' && $page['visits'] <= $page['views']))->toBeTrue()
        ->and($pages['/clicks']['frustration_per_100'])->toBeGreaterThan(0)
        ->and($pages['/forms']['abandons_per_100'])->toBeGreaterThan(0)
        ->and($pages['/long']['scrolled_all'])->toBeGreaterThan(0)->toBeLessThanOrEqual(1);
});

it('leaves out pages under the minimum and narrows to a device', function () {
    expect(site()->pages(10_000))->toBeEmpty()
        ->and(site('tablet')->pages(1))->toBeEmpty()
        ->and(site('desktop')->pages(1))->not->toBeEmpty();
});

it('maps Replicator and Bard sets to section names, numbering repeats and skipping disabled sets', function () {
    $blocks = Blocks::map([
        ['field' => 'page_builder', 'type' => 'replicator', 'value' => [
            ['id' => 'a', 'type' => 'hero'],
            ['id' => 'b', 'type' => 'bike_showcase'],
            ['id' => 'c', 'type' => 'faq', 'enabled' => false],
            ['id' => 'd', 'type' => 'faq'],
            ['id' => 'e', 'type' => 'faq'],
        ]],
        ['field' => 'body', 'type' => 'bard', 'value' => [
            ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Hi']]],
            ['type' => 'set', 'attrs' => ['id' => 'f', 'values' => ['type' => 'hero']]],
            ['type' => 'set', 'attrs' => ['id' => 'g', 'enabled' => false, 'values' => ['type' => 'cta']]],
        ]],
        ['field' => 'empty', 'type' => 'replicator', 'value' => null],
    ]);

    expect($blocks)->toBe([
        'hero' => ['field' => 'page_builder', 'index' => 0, 'type' => 'hero'],
        'bike-showcase' => ['field' => 'page_builder', 'index' => 1, 'type' => 'bike_showcase'],
        'faq' => ['field' => 'page_builder', 'index' => 3, 'type' => 'faq'],
        'faq-2' => ['field' => 'page_builder', 'index' => 4, 'type' => 'faq'],
        'hero-2' => ['field' => 'body', 'index' => 1, 'type' => 'hero'],
    ]);
});

it('reads a recorded visit as lines with no id and no clock time', function () {
    $visit = Visit::query()->whereIn('id', Footprint::onPage('/clicks')->ofType('rage')->select('visit_id'))->firstOrFail();
    $lines = Journey::lines($visit->footprints()->timeline()->get());

    expect($lines[0])->toStartWith('+')->toContain('view /clicks')
        ->and(collect($lines)->every(fn (string $line) => preg_match('/^\+\d+\.\ds /', $line) === 1))->toBeTrue()
        ->and(implode("\n", $lines))->toContain('rage click "')->not->toContain($visit->id)->not->toContain('dwell');
});

it('cuts a long visit short', function () {
    $events = collect(range(1, 70))->map(fn (int $i) => new Footprint(['type' => 'scroll', 't' => $i * 100, 'value' => 10]));

    expect(Journey::lines($events))->toHaveCount(61)
        ->and(Journey::lines($events)[60])->toBe('… 10 more');
});

it('flags a change as noise unless both sides are large enough and the difference is clear', function () {
    expect(Change::share(0.25, 400, 0.75, 400))->toBe(['before' => 0.25, 'after' => 0.75, 'change' => 0.5, 'noise' => false])
        ->and(Change::share(0.25, 20, 0.75, 20)['noise'])->toBeTrue()
        ->and(Change::share(0.50, 100, 0.52, 100)['noise'])->toBeTrue()
        ->and(Change::share(null, 100, 0.4, 100))->toBe(['before' => null, 'after' => 0.4, 'change' => null, 'noise' => null])
        ->and(Change::rate(2.0, 400, 0.5, 400)['noise'])->toBeFalse()
        ->and(Change::rate(1.0, 400, 1.0, 400)['noise'])->toBeTrue()
        ->and(Change::median(4000, 25, 9000, 400))->toBe(['before' => 4000, 'after' => 9000, 'change' => 5000, 'noise' => true]);
});
