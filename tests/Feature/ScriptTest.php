<?php

use Danielgnh\Footprint\Script;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Vite;

it('renders the stub and the deferred tracker', function () {
    $html = Blade::render('@footprint');
    $version = app(Script::class)->version();

    expect($html)
        ->toContain('<script>window.footprint=window.footprint||{q:[],track:function(){this.q.push([].slice.call(arguments))}};</script>')
        ->toContain('<script defer src="'.url('/footprint/footprint.js').'?v='.$version.'"')
        ->toContain('data-endpoint="'.url('/footprint/events').'"')
        ->toContain('data-sample="1"')
        ->toContain('data-gpc="true"');
});

it('passes the sample rate and the privacy signal setting', function () {
    config(['footprint.sample_rate' => 0.25, 'footprint.respect_gpc' => false]);

    expect(Blade::render('@footprint'))->toContain('data-sample="0.25"')->toContain('data-gpc="false"');

    config(['footprint.sample_rate' => 7]);

    expect(Blade::render('@footprint'))->toContain('data-sample="1"');
});

it('carries the CSP nonce on both tags', function () {
    Vite::useCspNonce('n0nce');

    expect(substr_count(Blade::render('@footprint'), 'nonce="n0nce"'))->toBe(2);
});

it('renders nothing when disabled', function () {
    config(['footprint.enabled' => false]);

    expect(Blade::render('@footprint'))->toBe('');
});

it('serves the built tracker, immutable only for the current version', function () {
    $version = app(Script::class)->version();

    $current = $this->get('/footprint/footprint.js?v='.$version)->assertOk();
    $stale = $this->get('/footprint/footprint.js?v=old')->assertOk();

    expect($current->headers->get('Content-Type'))->toBe('text/javascript; charset=utf-8')
        ->and($current->headers->get('Cache-Control'))->toContain('immutable')
        ->and(realpath($current->baseResponse->getFile()->getPathname()))->toBe(realpath(Script::PATH))
        ->and($stale->headers->get('Cache-Control'))->toContain('max-age=300')->not->toContain('immutable')
        ->and($current->headers->getCookies())->toBe([]);
});
