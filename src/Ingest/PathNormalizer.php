<?php

namespace Danielgnh\Footprint\Ingest;

use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Str;
use Throwable;

/**
 * The server-side twin of normalizePath() in resources/js/tracker/path.ts,
 * plus the redact_routes lookup the browser cannot do. Shared vectors live in
 * contract/cases/paths.json.
 */
final class PathNormalizer
{
    /** @var array<string, string> */
    private array $cache = [];

    /**
     * @param  list<string>  $redactRoutes
     */
    public function __construct(
        private readonly Router $router,
        private readonly array $redactRoutes = [],
    ) {}

    public function normalize(mixed $path): ?string
    {
        if (! is_string($path)) {
            return null;
        }

        return $this->cache[$path] ??= $this->resolve($path);
    }

    private function resolve(string $path): string
    {
        $segments = array_values(array_filter(
            explode('/', preg_split('/[?#]/', $path)[0] ?? ''),
            fn (string $segment): bool => $segment !== '',
        ));

        $route = $this->routeUri('/'.implode('/', $segments));

        if ($route !== null) {
            return mb_substr($route, 0, 255);
        }

        $segments = array_map(fn (string $segment): string => $this->secret($segment) ? '{token}' : $segment, $segments);

        return mb_substr('/'.implode('/', $segments), 0, 255);
    }

    private function secret(string $segment): bool
    {
        if (str_contains($segment, '@') || stripos($segment, '%40') !== false) {
            return true;
        }

        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $segment) === 1) {
            return true;
        }

        foreach (preg_split('/[-_.~]/', $segment) ?: [] as $part) {
            if (mb_strlen($part) >= 16 && preg_match('/[A-Za-z]/', $part) === 1 && preg_match('/[0-9]/', $part) === 1) {
                return true;
            }
        }

        return false;
    }

    private function routeUri(string $path): ?string
    {
        if ($this->redactRoutes === []) {
            return null;
        }

        try {
            $route = $this->router->getRoutes()->match(Request::create($path));
        } catch (Throwable) {
            return null;
        }

        $name = $route->getName();

        if ($name === null || ! Str::is($this->redactRoutes, $name)) {
            return null;
        }

        return '/'.ltrim($route->uri(), '/');
    }
}
