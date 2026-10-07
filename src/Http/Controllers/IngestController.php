<?php

namespace Danielgnh\Footprint\Http\Controllers;

use Danielgnh\Footprint\Ingest\Bots;
use Danielgnh\Footprint\Ingest\InvalidPayload;
use Danielgnh\Footprint\Ingest\PathNormalizer;
use Danielgnh\Footprint\Ingest\Payload;
use Danielgnh\Footprint\Ingest\Recorder;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use JsonException;

final class IngestController
{
    public const int MAX_BYTES = 65_536;

    public function __invoke(Request $request, PathNormalizer $paths, Recorder $recorder): Response
    {
        if ((int) $request->header('Content-Length') > self::MAX_BYTES || strlen($request->getContent()) > self::MAX_BYTES) {
            return response()->noContent(413);
        }

        $host = $this->pageHost($request);

        if ($host === null) {
            return response()->noContent(403);
        }

        if (Bots::is($request->userAgent())) {
            return response()->noContent();
        }

        try {
            $payload = Payload::from(json_decode($request->getContent(), true, 16, JSON_THROW_ON_ERROR), $paths);
        } catch (InvalidPayload|JsonException) {
            return response()->noContent(422);
        }

        $recorder->record($payload, $host);

        return response()->noContent();
    }

    /**
     * The host of the page that sent the batch, which is not the endpoint's
     * when a site posts here through allowed_hosts. Null when it is not a
     * host this app records.
     */
    private function pageHost(Request $request): ?string
    {
        $origin = $request->header('Origin');
        $referer = $request->header('Referer');

        $host = match (true) {
            filled($origin) && $origin !== 'null' => parse_url((string) $origin, PHP_URL_HOST),
            filled($referer) => parse_url((string) $referer, PHP_URL_HOST),
            $request->header('Sec-Fetch-Site') === 'same-origin' => $request->getHost(),
            default => null,
        };

        $allowed = array_map(strtolower(...), array_filter([
            $request->getHost(),
            parse_url((string) config('app.url'), PHP_URL_HOST),
            ...(array) config('footprint.allowed_hosts', []),
        ]));

        return is_string($host) && in_array(strtolower($host), $allowed, true) ? strtolower($host) : null;
    }
}
