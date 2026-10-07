<?php

namespace Danielgnh\Footprint;

use Illuminate\Support\Facades\Vite;

final class Script
{
    public const string PATH = __DIR__.'/../resources/dist/footprint.js';

    /**
     * The stub lets page code call footprint.track() before the deferred
     * tracker has loaded; the tracker replays the queue when it starts.
     */
    public function tag(): string
    {
        if (! config('footprint.enabled') || ! is_file(self::PATH)) {
            return '';
        }

        $nonce = Vite::cspNonce();
        $nonce = $nonce === null ? '' : ' nonce="'.e($nonce).'"';

        $attributes = [
            'src' => url((string) config('footprint.script')).'?v='.$this->version(),
            'data-endpoint' => url((string) config('footprint.endpoint')),
            'data-sample' => (string) max(0, min(1, (float) config('footprint.sample_rate'))),
            'data-gpc' => config('footprint.respect_gpc') ? 'true' : 'false',
        ];

        $attributes = implode(' ', array_map(fn (string $name, string $value): string => $name.'="'.e($value).'"', array_keys($attributes), $attributes));

        return '<script'.$nonce.'>window.footprint=window.footprint||{q:[],track:function(){this.q.push([].slice.call(arguments))}};</script>'
            .'<script defer'.$nonce.' '.$attributes.'></script>';
    }

    public function version(): string
    {
        return substr((string) md5_file(self::PATH), 0, 12);
    }
}
