<?php

use Danielgnh\Footprint\Ingest\PathNormalizer;
use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;
use Illuminate\Events\Dispatcher;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\DB;

it('stores a visit and its footprints', function () {
    ingest(batch(visit: [
        'ref' => 'l.instagram.com',
        'utm' => ['source' => 'meta', 'campaign' => 'creators'],
        'device' => 'mobile',
        'vw' => 350,
        'lang' => 'pt-PT',
    ]))->assertNoContent();

    $visit = Visit::sole();

    expect($visit->only(['id', 'host', 'entry_path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'device', 'viewport', 'lang', 'views', 'events']))
        ->toBe([
            'id' => VISIT_ID,
            'host' => 'localhost',
            'entry_path' => '/bikes/gravel',
            'referrer_host' => 'l.instagram.com',
            'utm_source' => 'meta',
            'utm_medium' => null,
            'utm_campaign' => 'creators',
            'device' => 'mobile',
            'viewport' => 350,
            'lang' => 'pt-PT',
            'views' => 1,
            'events' => 1,
        ])
        ->and(Footprint::sole()->only(['visit_id', 'view', 't', 'host', 'path', 'type']))
        ->toBe(['visit_id' => VISIT_ID, 'view' => 1, 't' => 100, 'host' => 'localhost', 'path' => '/bikes/gravel', 'type' => 'view']);
});

it('stores every event type in its columns', function () {
    ingest(batch([
        footprint('view', ['from' => '/start?x=1']),
        footprint('section', ['section' => 'hero', 'i' => 2]),
        footprint('dwell', ['section' => 'hero', 'value' => 2400]),
        footprint('dwell', ['section' => null, 'value' => 3100]),
        footprint('scroll', ['value' => 70]),
        footprint('click', ['target' => 'Build yours', 'href' => '/bikes/gravel/configuration', 'section' => 'hero', 'x' => 0.25, 'y' => 0.75]),
        footprint('rage', ['target' => 'Pay', 'section' => 'checkout', 'x' => 0.5, 'y' => 0.5]),
        footprint('dead', ['target' => 'img', 'section' => null, 'x' => null, 'y' => null]),
        footprint('field', ['target' => 'email', 'form' => 'quote']),
        footprint('submit', ['form' => 'quote']),
        footprint('abandon', ['target' => 'name', 'form' => 'quote']),
        footprint('custom', ['name' => 'configurator_option', 'props' => ['part' => 'wheels', 'price' => 650, 'preset' => false, 'note' => null]]),
    ]))->assertNoContent();

    $rows = Footprint::orderBy('id')->get()
        ->map(fn (Footprint $row) => array_filter($row->only(['type', 'section', 'section_index', 'target', 'href', 'previous', 'form', 'x', 'y', 'value', 'data']), fn ($value) => $value !== null))
        ->all();

    expect($rows)->toBe([
        ['type' => 'view', 'previous' => '/start'],
        ['type' => 'section', 'section' => 'hero', 'section_index' => 2],
        ['type' => 'dwell', 'section' => 'hero', 'value' => 2400],
        ['type' => 'dwell', 'value' => 3100],
        ['type' => 'scroll', 'value' => 70],
        ['type' => 'click', 'section' => 'hero', 'target' => 'Build yours', 'href' => '/bikes/gravel/configuration', 'x' => 0.25, 'y' => 0.75],
        ['type' => 'rage', 'section' => 'checkout', 'target' => 'Pay', 'x' => 0.5, 'y' => 0.5],
        ['type' => 'dead', 'target' => 'img'],
        ['type' => 'field', 'target' => 'email', 'form' => 'quote'],
        ['type' => 'submit', 'form' => 'quote'],
        ['type' => 'abandon', 'target' => 'name', 'form' => 'quote'],
        ['type' => 'custom', 'target' => 'configurator_option', 'data' => ['part' => 'wheels', 'price' => 650, 'preset' => false, 'note' => null]],
    ]);
});

it('stores empty custom props as an object', function () {
    ingest(batch([footprint('custom', ['name' => 'opened', 'props' => []])]));

    expect(DB::table('footprints')->value('data'))->toBe('{}');
});

it('accumulates a visit across batches', function () {
    $this->travelTo('2026-10-07 10:00:00');
    ingest(batch([footprint('view', ['from' => null]), footprint('scroll', ['value' => 10])]));

    $this->travelTo('2026-10-07 10:00:15');
    ingest(batch([footprint('dwell', ['section' => null, 'value' => 15000]), footprint('view', ['view' => 2, 'path' => '/wheels', 'from' => '/bikes/gravel'])]));

    $visit = Visit::sole();

    expect([$visit->views, $visit->events, $visit->entry_path])->toBe([2, 4, '/bikes/gravel'])
        ->and($visit->started_at->toDateTimeString())->toBe('2026-10-07 10:00:00')
        ->and($visit->ended_at->toDateTimeString())->toBe('2026-10-07 10:00:15');
});

it('takes the entry path from the first view, whatever comes first in the batch', function () {
    ingest(batch([footprint('scroll', ['value' => 10, 'path' => '/elsewhere']), footprint('view', ['from' => null])]));

    expect(Visit::sole()->entry_path)->toBe('/bikes/gravel');
});

describe('origin', function () {
    it('rejects a batch posted from another site', function () {
        ingest(batch(), ['HTTP_ORIGIN' => 'https://evil.test'])->assertStatus(403);

        expect(Visit::count())->toBe(0);
    });

    it('falls back to the referer when there is no origin', function () {
        ingest(batch(), ['HTTP_ORIGIN' => '', 'HTTP_REFERER' => 'http://localhost/bikes'])->assertNoContent();
        ingest(batch(), ['HTTP_ORIGIN' => 'null', 'HTTP_REFERER' => 'https://evil.test/'])->assertStatus(403);
    });

    it('trusts the browser\'s same-origin fetch metadata when both are stripped', function () {
        ingest(batch(), ['HTTP_ORIGIN' => '', 'HTTP_SEC_FETCH_SITE' => 'same-origin'])->assertNoContent();
        ingest(batch(), ['HTTP_ORIGIN' => '', 'HTTP_SEC_FETCH_SITE' => 'cross-site'])->assertStatus(403);
        ingest(batch(), ['HTTP_ORIGIN' => ''])->assertStatus(403);
    });

    it('accepts the app URL host and configured hosts', function () {
        config(['app.url' => 'https://bikes.irondeer.pt', 'footprint.allowed_hosts' => ['WWW.irondeer.pt']]);

        ingest(batch(), ['HTTP_ORIGIN' => 'https://bikes.irondeer.pt'])->assertNoContent();
        ingest(batch(), ['HTTP_ORIGIN' => 'https://www.irondeer.pt'])->assertNoContent();
        ingest(batch(), ['HTTP_ORIGIN' => 'https://shop.irondeer.pt'])->assertStatus(403);
    });
});

describe('bots', function () {
    it('answers bots without storing anything', function (string $agent) {
        ingest(batch(), ['HTTP_USER_AGENT' => $agent])->assertNoContent();

        expect(Visit::count())->toBe(0);
    })->with([
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome-Lighthouse',
        'curl/8.7.1',
        'python-requests/2.32',
        '',
    ]);
});

describe('validation', function () {
    it('rejects a body over 64 kB', function () {
        $events = array_fill(0, 200, footprint('custom', ['name' => 'x', 'props' => ['a' => str_repeat('é', 100), 'b' => str_repeat('é', 100)]]));

        ingest(batch($events))->assertStatus(413);
    });

    it('rejects a malformed envelope', function (string|array $body) {
        ingest($body)->assertStatus(422);

        expect(Visit::count())->toBe(0);
    })->with([
        'not json' => ['{"v":1,'],
        'not an object' => ['"hello"'],
        'wrong version' => fn () => [...batch(), 'v' => 2],
        'no events' => fn () => batch([]),
        'events not a list' => fn () => [...batch(), 'events' => ['a' => footprint('view')]],
        '201 events' => fn () => batch(array_fill(0, 201, footprint('scroll', ['value' => 10]))),
        'no visit' => fn () => array_diff_key(batch(), ['visit' => true]),
        'bad visit id' => fn () => batch(visit: ['id' => 'not-a-uuid']),
        'uppercase visit id' => fn () => batch(visit: ['id' => strtoupper(VISIT_ID)]),
        'unknown device' => fn () => batch(visit: ['device' => 'fridge']),
        'viewport not an integer' => fn () => batch(visit: ['vw' => '1400']),
        'nested too deep' => fn () => batch([footprint('custom', ['name' => 'x', 'props' => ['a' => [[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]])]),
    ]);

    it('drops invalid events and keeps the rest', function () {
        ingest(batch([
            footprint('view', ['from' => null]),
            footprint('teleport'),
            footprint('scroll', ['value' => 55]),
            footprint('scroll', ['value' => 110]),
            footprint('click', ['target' => '   ', 'href' => null, 'section' => null, 'x' => null, 'y' => null]),
            footprint('section', ['section' => null, 'i' => 0]),
            footprint('dwell', ['section' => 'hero', 'value' => 0]),
            footprint('custom', ['name' => 'has space', 'props' => []]),
            footprint('field', ['target' => null, 'form' => null]),
            ['type' => 'view', 't' => 1, 'view' => 1],
            ['type' => 'view', 't' => -1, 'view' => 1, 'path' => '/'],
            ['type' => 'view', 't' => 1.5, 'view' => 1, 'path' => '/'],
            ['type' => 'view', 't' => 1, 'view' => 0, 'path' => '/'],
            'garbage',
        ]))->assertNoContent();

        expect(Footprint::pluck('type')->all())->toBe(['view'])
            ->and(Visit::sole()->events)->toBe(1);
    });

    it('stores no visit when every event was dropped', function () {
        ingest(batch([footprint('teleport')]))->assertNoContent();

        expect(Visit::count())->toBe(0);
    });

    it('clamps and cleans what it keeps', function () {
        ingest(batch([
            ['type' => 'dwell', 't' => 999_999_999, 'view' => 1, 'path' => '/', 'section' => null, 'value' => 99_999_999],
            footprint('click', ['target' => 'Mail jane@example.com '.str_repeat('x', 200), 'href' => 'evil host/', 'section' => str_repeat('s', 150), 'x' => 1.5, 'y' => -0.1]),
            footprint('click', ['target' => 'b', 'href' => 'WWW.Instagram.COM', 'section' => null, 'x' => 0.123456, 'y' => 1]),
            footprint('click', ['target' => 'c', 'href' => 'javascript:alert(1)', 'section' => null, 'x' => '0.5', 'y' => null]),
            footprint('click', ['target' => 'd', 'href' => '#jane@example.com', 'section' => null, 'x' => null, 'y' => null]),
            footprint('section', ['section' => 'hero', 'i' => 5000]),
        ], ['ref' => 'evil host', 'vw' => 1433, 'lang' => str_repeat('l', 40), 'utm' => ['source' => 'jane@example.com', 'term' => 'x']]))->assertNoContent();

        $rows = Footprint::orderBy('id')->get();
        $visit = Visit::sole();

        expect($rows[0]->only(['t', 'value']))->toBe(['t' => 86_400_000, 'value' => 3_600_000])
            ->and($rows[1]->target)->toStartWith('Mail {email} xxx')->toHaveLength(100)
            ->and($rows[1]->only(['href', 'x', 'y']))->toBe(['href' => null, 'x' => null, 'y' => null])
            ->and(mb_strlen((string) $rows[1]->section))->toBe(100)
            ->and($rows[2]->only(['href', 'x', 'y']))->toBe(['href' => 'www.instagram.com', 'x' => 0.1235, 'y' => 1.0])
            ->and($rows[3]->only(['href', 'x']))->toBe(['href' => null, 'x' => null])
            ->and($rows[4]->href)->toBe('#{email}')
            ->and($rows[5]->section_index)->toBe(1000)
            ->and($visit->only(['referrer_host', 'viewport', 'utm_source']))->toBe(['referrer_host' => null, 'viewport' => 1400, 'utm_source' => '{email}'])
            ->and(mb_strlen((string) $visit->lang))->toBe(20);
    });
});

describe('paths', function () {
    it('normalises page, link and previous paths', function () {
        ingest(batch([
            footprint('view', ['path' => '/orders/'.TOKEN.'?paid=1', 'from' => '/bikes/gravel/?size=M']),
            footprint('click', ['path' => '/orders/'.TOKEN, 'target' => 'Receipt', 'href' => '/receipts/'.TOKEN.'#print', 'section' => null, 'x' => null, 'y' => null]),
        ]))->assertNoContent();

        expect(Footprint::orderBy('id')->get()->map->only(['path', 'href', 'previous'])->all())->toBe([
            ['path' => '/orders/{token}', 'href' => null, 'previous' => '/bikes/gravel'],
            ['path' => '/orders/{token}', 'href' => '/receipts/{token}', 'previous' => null],
        ])->and(Visit::sole()->entry_path)->toBe('/orders/{token}');
    });

    it('stores a redacted route as its URI, wherever the path appears', function () {
        $router = new Router(new Dispatcher);
        $router->get('/pt/orders/{order:token}', fn () => 'order')->name('pt.orders.show');
        $router->get('/pt/journal/{entry}', fn () => 'entry')->name('pt.journal.show');
        app()->instance(PathNormalizer::class, new PathNormalizer($router, ['*.orders.show']));

        ingest(batch([
            footprint('view', ['path' => '/pt/orders/12345', 'from' => null]),
            footprint('view', ['view' => 2, 'path' => '/pt/journal/silver-coast', 'from' => '/pt/orders/12345']),
            footprint('click', ['view' => 2, 'path' => '/pt/journal/silver-coast', 'target' => 'Your order', 'href' => '/pt/orders/12345', 'section' => null, 'x' => null, 'y' => null]),
        ]))->assertNoContent();

        expect(Footprint::orderBy('id')->get()->map->only(['path', 'previous', 'href'])->all())->toBe([
            ['path' => '/pt/orders/{order}', 'previous' => null, 'href' => null],
            ['path' => '/pt/journal/silver-coast', 'previous' => '/pt/orders/{order}', 'href' => null],
            ['path' => '/pt/journal/silver-coast', 'previous' => null, 'href' => '/pt/orders/{order}'],
        ]);
    });

    it('only redacts routes that match the path first', function () {
        $router = new Router(new Dispatcher);
        $router->get('/{segments?}', fn () => 'page')->where('segments', '.*')->name('cms.catchall');
        $router->get('/orders/{order}', fn () => 'order')->name('en.orders.show');

        expect((new PathNormalizer($router, ['*.orders.show']))->normalize('/orders/12345'))->toBe('/orders/12345');
    });

    it('reads redact_routes from config', function () {
        config(['footprint.redact_routes' => ['*.orders.show']]);
        app()->forgetScopedInstances();

        expect((fn () => $this->redactRoutes)->call(app(PathNormalizer::class)))->toBe(['*.orders.show']);
    });
});

describe('privacy', function () {
    it('stores neither the IP address nor the user agent', function () {
        ingest(batch([footprint('view', ['from' => null]), footprint('field', ['target' => 'email', 'form' => 'quote'])]))->assertNoContent();

        $stored = json_encode([DB::table('footprint_visits')->get(), DB::table('footprints')->get()], JSON_THROW_ON_ERROR);

        expect($stored)->not->toContain('203.0.113.7')->not->toContain('Safari')->not->toContain('Macintosh');
    });

    it('sets no cookie and starts no session', function () {
        $response = ingest(batch());

        expect($response->headers->getCookies())->toBe([])
            ->and($response->headers->has('Set-Cookie'))->toBeFalse();
    });
});

it('rate limits one address', function () {
    config(['footprint.rate_limit' => 3]);

    foreach (range(1, 3) as $i) {
        ingest(batch())->assertNoContent();
    }

    ingest(batch())->assertStatus(429);
    ingest(batch(), ['REMOTE_ADDR' => '198.51.100.4'])->assertNoContent();
});

it('records nothing for a GET', function () {
    expect($this->get('/footprint/events')->status())->toBeIn([404, 405])
        ->and(Visit::count())->toBe(0);
});
