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

        if (! $this->sameSite($request)) {
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

        $recorder->record($payload, strtolower($request->getHost()));

        return response()->noContent();
    }

    private function sameSite(Request $request): bool
    {
        $allowed = array_map(strtolower(...), array_filter([
            $request->getHost(),
            parse_url((string) config('app.url'), PHP_URL_HOST),
            ...(array) config('footprint.allowed_hosts', []),
        ]));

        $origin = $request->header('Origin');

        if (filled($origin) && $origin !== 'null') {
            return in_array(strtolower((string) parse_url($origin, PHP_URL_HOST)), $allowed, true);
        }

        $referer = $request->header('Referer');

        if (filled($referer)) {
            return in_array(strtolower((string) parse_url($referer, PHP_URL_HOST)), $allowed, true);
        }

        return $request->header('Sec-Fetch-Site') === 'same-origin';
    }
}
