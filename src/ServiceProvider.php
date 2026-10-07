<?php

namespace Danielgnh\Footprint;

use Danielgnh\Footprint\Ingest\PathNormalizer;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider as BaseServiceProvider;
use Throwable;

class ServiceProvider extends BaseServiceProvider
{
    #[\Override]
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/footprint.php', 'footprint');

        $this->app->singleton(Script::class);

        $this->app->scoped(PathNormalizer::class, fn ($app): PathNormalizer => new PathNormalizer(
            $app['router'],
            array_values((array) config('footprint.redact_routes', [])),
        ));
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/footprint.php' => config_path('footprint.php'),
        ], 'footprint-config');

        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');

        Blade::directive('footprint', fn (): string => '<?php echo app(\\'.Script::class.'::class)->tag(); ?>');

        if (! config('footprint.enabled')) {
            return;
        }

        RateLimiter::for('footprint', fn (Request $request): Limit => Limit::perMinute((int) config('footprint.rate_limit', 120))
            ->by(hash_hmac('sha256', (string) $request->ip(), (string) config('app.key'))));

        try {
            $this->loadRoutesFrom(__DIR__.'/../routes/footprint.php');
        } catch (Throwable $e) {
            report($e); // a misconfiguration must never take the host site down

            Log::warning('Footprint failed to mount its routes.', ['exception' => $e->getMessage()]);
        }
    }
}
