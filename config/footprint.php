<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Enabled
    |--------------------------------------------------------------------------
    |
    | Switches the whole package off: no script tag, no routes.
    |
    */

    'enabled' => env('FOOTPRINT_ENABLED', true),

    /*
    |--------------------------------------------------------------------------
    | Database connection
    |--------------------------------------------------------------------------
    |
    | Where visits and footprints are stored. Null uses the app's default.
    |
    */

    'connection' => env('FOOTPRINT_DB_CONNECTION'),

    /*
    |--------------------------------------------------------------------------
    | Routes
    |--------------------------------------------------------------------------
    |
    | The tracker posts its batches to the endpoint and loads from the script
    | URL. Both live outside the web middleware group: no session, no cookies
    | read, no CSRF.
    |
    */

    'endpoint' => '/footprint/events',

    'script' => '/footprint/footprint.js',

    /*
    |--------------------------------------------------------------------------
    | Sampling and privacy signals
    |--------------------------------------------------------------------------
    |
    | sample_rate is the share of page loads that record anything, 0 to 1.
    | With respect_gpc on, a browser sending Global Privacy Control or Do Not
    | Track records nothing.
    |
    */

    'sample_rate' => (float) env('FOOTPRINT_SAMPLE_RATE', 1.0),

    'respect_gpc' => true,

    /*
    |--------------------------------------------------------------------------
    | Allowed hosts
    |--------------------------------------------------------------------------
    |
    | Batches are accepted from the endpoint's own host and the app URL's host.
    | List any other host whose pages post here.
    |
    */

    'allowed_hosts' => [],

    /*
    |--------------------------------------------------------------------------
    | Redacted routes
    |--------------------------------------------------------------------------
    |
    | Route name patterns whose paths are stored as the route's URI instead,
    | for URLs carrying something private that the token heuristic would not
    | catch, e.g. ['*.orders.show'] stores /orders/{order}.
    |
    */

    'redact_routes' => [],

    /*
    |--------------------------------------------------------------------------
    | Rate limit
    |--------------------------------------------------------------------------
    |
    | Batches per minute from one IP address. The address is only hashed into
    | a cache key that expires with the minute.
    |
    */

    'rate_limit' => 120,

];
