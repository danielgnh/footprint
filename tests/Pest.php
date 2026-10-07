<?php

declare(strict_types=1);

use Danielgnh\Footprint\Tests\TestCase;
use Illuminate\Testing\TestResponse;

uses(TestCase::class)->in(__DIR__);

const VISIT_ID = '6f1c2c3e-1b2a-4c3d-8e4f-5a6b7c8d9e0f';

const OTHER_VISIT = '0b5e1c9a-7d2f-4e3b-9a8c-1f2e3d4c5b6a';

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const TOKEN = 'Xk9fQ2LmP0aZ7bR4tY1uW8eV3sD6gH5jN2kL9mQ0';

/**
 * @param  list<array<string, mixed>>|null  $events
 * @param  array<string, mixed>  $visit
 * @return array<string, mixed>
 */
function batch(?array $events = null, array $visit = []): array
{
    return [
        'v' => 1,
        'visit' => [
            'id' => VISIT_ID,
            'ref' => null,
            'utm' => [],
            'device' => 'desktop',
            'vw' => 1400,
            'lang' => 'en',
            ...$visit,
        ],
        'events' => $events ?? [footprint('view', ['from' => null])],
    ];
}

/**
 * @param  array<string, mixed>  $fields
 * @return array<string, mixed>
 */
function footprint(string $type, array $fields = []): array
{
    return ['type' => $type, 't' => 100, 'view' => 1, 'path' => '/bikes/gravel', ...$fields];
}

/**
 * @param  array<string, mixed>|string  $batch
 * @param  array<string, string>  $server
 */
function ingest(array|string $batch, array $server = []): TestResponse
{
    return test()->call('POST', '/footprint/events', [], [], [], [
        'CONTENT_TYPE' => 'text/plain;charset=UTF-8',
        'HTTP_ORIGIN' => 'http://localhost',
        'HTTP_USER_AGENT' => BROWSER,
        'REMOTE_ADDR' => '203.0.113.7',
        ...$server,
    ], is_string($batch) ? $batch : json_encode($batch, JSON_THROW_ON_ERROR));
}
