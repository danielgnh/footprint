<?php

namespace Danielgnh\Footprint\Ingest;

use InvalidArgumentException;

final class InvalidPayload extends InvalidArgumentException
{
    public static function because(string $reason): self
    {
        return new self("Invalid footprint batch: {$reason}.");
    }
}
