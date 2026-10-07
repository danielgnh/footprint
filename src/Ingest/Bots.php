<?php

declare(strict_types=1);

namespace Danielgnh\Footprint\Ingest;

final class Bots
{
    private const string PATTERN = '/bot|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|httpclient|guzzle|phantom|puppeteer|playwright|selenium|cypress/i';

    public static function is(?string $agent): bool
    {
        return blank($agent) || preg_match(self::PATTERN, $agent) === 1;
    }
}
