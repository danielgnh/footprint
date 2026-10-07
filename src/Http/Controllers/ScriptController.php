<?php

namespace Danielgnh\Footprint\Http\Controllers;

use Danielgnh\Footprint\Script;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class ScriptController
{
    public function __invoke(Request $request, Script $script): BinaryFileResponse
    {
        abort_unless(is_file(Script::PATH), 404);

        $immutable = $request->query('v') === $script->version();

        return response()->file(Script::PATH, [
            'Content-Type' => 'text/javascript; charset=utf-8',
            'Cache-Control' => $immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
