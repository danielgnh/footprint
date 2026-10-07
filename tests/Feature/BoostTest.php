<?php

use Illuminate\Support\Facades\Blade;

it('renders the guideline without running the directives it describes', function () {
    $guideline = Blade::render((string) file_get_contents(__DIR__.'/../../resources/boost/guidelines/core.blade.php'));

    expect($guideline)
        ->toContain('## Footprint')
        ->toContain('@footprint')
        ->toContain('@guest')
        ->not->toContain('<script')
        ->toContain('danielgnh/footprint-statamic')
        ->toContain('footprint-statamic-interactions')
        ->toContain('footprint-statamic-mcp');
});
