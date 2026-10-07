<?php

use Danielgnh\Footprint\Http\Controllers\IngestController;
use Danielgnh\Footprint\Http\Controllers\ScriptController;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Route;

Route::post(config('footprint.endpoint'), IngestController::class)
    ->middleware(ThrottleRequests::using('footprint'))
    ->name('footprint.events');

Route::get(config('footprint.script'), ScriptController::class)
    ->name('footprint.script');
