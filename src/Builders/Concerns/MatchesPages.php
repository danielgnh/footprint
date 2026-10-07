<?php

namespace Danielgnh\Footprint\Builders\Concerns;

use Danielgnh\Footprint\Ingest\PathNormalizer;

trait MatchesPages
{
    public function onHost(string $host): static
    {
        return $this->where($this->qualifyColumn('host'), strtolower($host));
    }

    /**
     * Normalises the URL the way ingest stored it, so a full URL, a path with
     * a query string or a path holding a token all find their rows. A URL
     * with a host also matches the host.
     */
    protected function matchingPage(string $column, string $url): static
    {
        $this->where($this->qualifyColumn($column), app(PathNormalizer::class)->normalize((string) parse_url($url, PHP_URL_PATH)));

        $host = parse_url($url, PHP_URL_HOST);

        return is_string($host) ? $this->onHost($host) : $this;
    }
}
