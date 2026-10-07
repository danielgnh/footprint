<?php

use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;
use Illuminate\Support\Carbon;

it('finds a page by its url or its path, normalised the way it was stored', function () {
    ingest(batch([
        footprint('view', ['from' => null]),
        footprint('view', ['view' => 2, 'path' => '/reset/'.TOKEN, 'from' => '/bikes/gravel']),
    ]))->assertNoContent();

    expect(Footprint::onPage('http://localhost/bikes/gravel/?utm_source=x#specs')->count())->toBe(1)
        ->and(Footprint::onPage('/bikes/gravel')->count())->toBe(1)
        ->and(Footprint::onPage('/reset/'.TOKEN)->count())->toBe(1)
        ->and(Footprint::onPage('https://example.com/bikes/gravel')->count())->toBe(0)
        ->and(Footprint::onPage('/bikes')->count())->toBe(0)
        ->and(Footprint::onHost('LOCALHOST')->count())->toBe(2);
});

it('keeps a range to the rows that arrived inside it', function () {
    $monday = Carbon::parse('2026-10-05 10:00:00');

    $this->travelTo($monday);
    ingest(batch())->assertNoContent();

    $this->travelTo($monday->copy()->addDay());
    ingest(batch([footprint('scroll', ['value' => 50])]))->assertNoContent();

    expect(Footprint::between($monday, $monday->copy()->addDay())->pluck('type')->all())->toBe(['view'])
        ->and(Footprint::between($monday, $monday->copy()->addDay()->addSecond())->count())->toBe(2);
});

it('narrows rows to the visits from one device', function () {
    ingest(batch(visit: ['device' => 'mobile', 'vw' => 390]))->assertNoContent();
    ingest(batch(visit: ['id' => OTHER_VISIT]))->assertNoContent();

    expect(Footprint::onDevice('mobile')->sole()->visit_id)->toBe(VISIT_ID)
        ->and(Footprint::onDevice('desktop')->sole()->visit_id)->toBe(OTHER_VISIT)
        ->and(Footprint::onDevice('tablet')->count())->toBe(0);
});

it('filters by type and section', function () {
    ingest(batch([
        footprint('click', ['target' => 'Build yours', 'section' => 'hero', 'x' => 0.5, 'y' => 0.5]),
        footprint('rage', ['target' => 'Pay', 'section' => 'checkout', 'x' => 0.5, 'y' => 0.5]),
        footprint('dead', ['target' => 'img', 'section' => 'hero', 'x' => 0.1, 'y' => 0.2]),
    ]))->assertNoContent();

    expect(Footprint::ofType('rage', 'dead')->pluck('target')->sort()->values()->all())->toBe(['Pay', 'img'])
        ->and(Footprint::ofType('rage', 'dead')->inSection('hero')->sole()->target)->toBe('img');
});

it('sums dwell deltas into the time each section was on screen in each view', function () {
    ingest(batch([
        footprint('view', ['from' => null]),
        footprint('dwell', ['section' => 'hero', 'value' => 1000]),
        footprint('dwell', ['section' => null, 'value' => 1500]),
    ]))->assertNoContent();

    ingest(batch([
        footprint('dwell', ['section' => 'hero', 'value' => 500, 't' => 15_000]),
        footprint('dwell', ['section' => null, 'value' => 2000, 't' => 15_000]),
        footprint('view', ['view' => 2, 'path' => '/bikes', 'from' => '/bikes/gravel', 't' => 16_000]),
        footprint('dwell', ['view' => 2, 'path' => '/bikes', 'section' => 'hero', 'value' => 700, 't' => 30_000]),
    ]))->assertNoContent();

    $dwell = Footprint::onPage('/bikes/gravel')->dwellPerView()->get();

    expect($dwell->map->only(['section', 'view', 'ms'])->sortBy('section')->values()->all())->toBe([
        ['section' => null, 'view' => 1, 'ms' => 3500],
        ['section' => 'hero', 'view' => 1, 'ms' => 1500],
    ]);
});

it('takes the deepest scroll of each view', function () {
    ingest(batch([
        footprint('view', ['from' => null]),
        footprint('scroll', ['value' => 10]),
        footprint('scroll', ['value' => 40]),
        footprint('scroll', ['value' => 70]),
    ]))->assertNoContent();

    ingest(batch([footprint('view', ['from' => null]), footprint('scroll', ['value' => 20])], ['id' => OTHER_VISIT]))->assertNoContent();

    expect(Footprint::onPage('/bikes/gravel')->deepestScroll()->get()->pluck('depth', 'visit_id')->all())
        ->toEqual([VISIT_ID => 70, OTHER_VISIT => 20]);
});

it('lists each section once per view that reached it', function () {
    ingest(batch([
        footprint('view', ['from' => null]),
        footprint('section', ['section' => 'header', 'i' => 0]),
        footprint('section', ['section' => 'hero', 'i' => 1]),
        footprint('section', ['section' => 'faq', 'i' => 3]),
        footprint('section', ['section' => 'faq', 'i' => 4]),
    ]))->assertNoContent();

    ingest(batch([footprint('view', ['from' => null]), footprint('section', ['section' => 'header', 'i' => 0])], ['id' => OTHER_VISIT]))->assertNoContent();

    $reached = Footprint::onPage('/bikes/gravel')->reachedSections()->get();

    expect($reached->countBy('section')->all())->toEqual(['header' => 2, 'hero' => 1, 'faq' => 1])
        ->and($reached->firstWhere('section', 'faq')->position)->toBe(3);
});

it('replays a visit in the order it happened, without dwell', function () {
    ingest(batch([
        footprint('view', ['from' => null, 't' => 0]),
        footprint('dwell', ['section' => null, 'value' => 900, 't' => 15_000]),
        footprint('click', ['target' => 'Specs', 'section' => null, 'x' => null, 'y' => null, 't' => 4000]),
        footprint('section', ['section' => 'hero', 'i' => 0, 't' => 50]),
    ]))->assertNoContent();

    expect(Visit::sole()->footprints()->timeline()->pluck('type')->all())->toBe(['view', 'section', 'click']);
});

it('finds visits by where they landed, on which device and when they started', function () {
    $monday = Carbon::parse('2026-10-05 10:00:00');

    $this->travelTo($monday);
    ingest(batch(visit: ['device' => 'mobile', 'vw' => 390]))->assertNoContent();

    $this->travelTo($monday->copy()->addHour());
    ingest(batch([footprint('view', ['path' => '/bikes', 'from' => null])], ['id' => OTHER_VISIT]))->assertNoContent();

    expect(Visit::landedOn('http://localhost/bikes/gravel?ref=x')->sole()->id)->toBe(VISIT_ID)
        ->and(Visit::landedOn('https://example.com/bikes/gravel')->count())->toBe(0)
        ->and(Visit::onDevice('desktop')->sole()->id)->toBe(OTHER_VISIT)
        ->and(Visit::between($monday, $monday->copy()->addHour())->sole()->id)->toBe(VISIT_ID)
        ->and(Visit::onHost('localhost')->count())->toBe(2);
});

it('composes with Eloquent: visits that gave up on a field of a page', function () {
    ingest(batch([
        footprint('view', ['from' => null]),
        footprint('abandon', ['target' => 'email', 'form' => 'quote']),
    ]))->assertNoContent();

    ingest(batch([
        footprint('view', ['from' => null]),
        footprint('abandon', ['target' => 'name', 'form' => 'quote']),
    ], ['id' => OTHER_VISIT]))->assertNoContent();

    $visits = Visit::whereHas('footprints', fn ($footprints) => $footprints->onPage('/bikes/gravel')->ofType('abandon')->where('target', 'email'));

    expect($visits->pluck('id')->all())->toBe([VISIT_ID]);
});
