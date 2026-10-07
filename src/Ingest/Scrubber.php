<?php

namespace Danielgnh\Footprint\Ingest;

/**
 * The server-side twin of scrub() in resources/js/tracker/path.ts. Both run
 * the vectors in contract/cases/scrub.json, so they cannot drift apart.
 */
final class Scrubber
{
    private const string SPACE = '/[\t\n\x{0B}\f\r \x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+/u';

    public static function text(mixed $value, int $max): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $clean = trim((string) preg_replace(self::SPACE, ' ', $value), ' ');
        $clean = (string) preg_replace('/[^ @]+@[^ @]+\.[^ @]+/u', '{email}', $clean);
        $clean = (string) preg_replace_callback(
            '/\+?[0-9][0-9 ().\/-]*[0-9]/',
            fn (array $match): string => strlen((string) preg_replace('/[^0-9]/', '', $match[0])) >= 5 ? '{n}' : $match[0],
            $clean,
        );

        $cut = trim(mb_substr($clean, 0, $max), ' ');

        return $cut === '' ? null : $cut;
    }
}
