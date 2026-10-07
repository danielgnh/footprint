<?php

use Danielgnh\Footprint\Ingest\PathNormalizer;
use Danielgnh\Footprint\Ingest\Scrubber;

/**
 * @return array<int, array{in: string, out: ?string, max?: int}>
 */
function cases(string $name): array
{
    return json_decode((string) file_get_contents(__DIR__."/../../contract/cases/{$name}.json"), true, 512, JSON_THROW_ON_ERROR);
}

it('scrubs text exactly like the tracker', function (string $in, int $max, ?string $out) {
    expect(Scrubber::text($in, $max))->toBe($out);
})->with(fn () => array_map(fn (array $case) => [$case['in'], $case['max'], $case['out']], cases('scrub')));

it('normalises paths exactly like the tracker', function (string $in, string $out) {
    expect(app(PathNormalizer::class)->normalize($in))->toBe($out);
})->with(fn () => array_map(fn (array $case) => [$case['in'], $case['out']], cases('paths')));

it('returns null for anything but a string', function () {
    expect(Scrubber::text(42, 60))->toBeNull()
        ->and(Scrubber::text(['a'], 60))->toBeNull()
        ->and(app(PathNormalizer::class)->normalize(null))->toBeNull();
});
