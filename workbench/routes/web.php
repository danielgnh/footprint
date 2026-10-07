<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::view('/smoke', 'smoke');

Route::get('/_footprint/rows', fn () => [
    'visits' => DB::table('footprint_visits')->get(),
    'footprints' => DB::table('footprints')->orderBy('id')->get(),
]);
