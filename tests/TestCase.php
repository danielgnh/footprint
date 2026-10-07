<?php

namespace Danielgnh\Footprint\Tests;

use Danielgnh\Footprint\ServiceProvider;
use Illuminate\Encryption\Encrypter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Orchestra\Testbench\TestCase as Orchestra;

abstract class TestCase extends Orchestra
{
    use RefreshDatabase;

    #[\Override]
    protected function getPackageProviders($app)
    {
        return [ServiceProvider::class];
    }

    #[\Override]
    protected function getEnvironmentSetUp($app)
    {
        $cipher = $app['config']->get('app.cipher', 'AES-256-CBC');
        $app['config']->set('app.key', 'base64:'.base64_encode(Encrypter::generateKey($cipher)));
        $app['config']->set('app.url', 'http://localhost');

        // testbench.yaml configures the workbench app; the suite keeps its own.
        $app['config']->set('database.default', 'testing');
        $app['config']->set('cache.default', 'array');
        $app['config']->set('session.driver', 'array');
    }
}
