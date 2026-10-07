<?php

namespace Danielgnh\Footprint\Ingest;

/**
 * Enforces contract/batch.schema.json on the server. A batch whose envelope
 * is malformed is rejected; a single event that is malformed, or of a type
 * this version does not know, is dropped so a newer tracker never loses the
 * rest of its batch. Every string is scrubbed and truncated again here.
 */
final readonly class Payload
{
    public const int MAX_EVENTS = 200;

    private const string UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/';

    private const string HOST = '/^[a-z0-9.-]{1,255}$/';

    private const string NAME = '/^[A-Za-z0-9_.:-]{1,60}$/';

    private const string PROP = '/^[A-Za-z0-9_.:-]{1,40}$/';

    private const array TYPES = ['view', 'section', 'dwell', 'scroll', 'click', 'rage', 'dead', 'field', 'submit', 'abandon', 'custom'];

    /**
     * @param  array{id: string, ref: ?string, utm: array<string, string>, device: string, vw: int, lang: ?string}  $visit
     * @param  list<array<string, mixed>>  $events
     */
    private function __construct(
        public array $visit,
        public array $events,
    ) {}

    public static function from(mixed $data, PathNormalizer $paths): self
    {
        if (! is_array($data) || data_get($data, 'v') !== 1) {
            throw InvalidPayload::because('unknown version');
        }

        $events = data_get($data, 'events');

        if (! is_array($events) || ! array_is_list($events) || $events === [] || count($events) > self::MAX_EVENTS) {
            throw InvalidPayload::because('events must be a list of 1 to '.self::MAX_EVENTS);
        }

        return new self(
            self::visit(data_get($data, 'visit')),
            array_values(array_filter(array_map(fn (mixed $event): ?array => self::event($event, $paths), $events))),
        );
    }

    /**
     * @return array{id: string, ref: ?string, utm: array<string, string>, device: string, vw: int, lang: ?string}
     */
    private static function visit(mixed $visit): array
    {
        if (! is_array($visit)) {
            throw InvalidPayload::because('visit missing');
        }

        $id = data_get($visit, 'id');
        $device = data_get($visit, 'device');
        $vw = data_get($visit, 'vw');

        if (! is_string($id) || preg_match(self::UUID, $id) !== 1) {
            throw InvalidPayload::because('visit id');
        }

        if (! in_array($device, ['mobile', 'tablet', 'desktop'], true)) {
            throw InvalidPayload::because('device');
        }

        if (! is_int($vw)) {
            throw InvalidPayload::because('viewport');
        }

        $utm = [];

        foreach (['source', 'medium', 'campaign', 'content'] as $key) {
            $value = Scrubber::text(data_get($visit, "utm.{$key}"), 100);

            if ($value !== null) {
                $utm[$key] = $value;
            }
        }

        return [
            'id' => $id,
            'ref' => self::host(data_get($visit, 'ref')),
            'utm' => $utm,
            'device' => $device,
            'vw' => intdiv(max(0, min(10000, $vw)), 50) * 50,
            'lang' => Scrubber::text(data_get($visit, 'lang'), 20),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function event(mixed $event, PathNormalizer $paths): ?array
    {
        if (! is_array($event)) {
            return null;
        }

        $type = data_get($event, 'type');
        $t = data_get($event, 't');
        $view = data_get($event, 'view');
        $path = $paths->normalize(data_get($event, 'path'));

        if (! in_array($type, self::TYPES, true) || ! is_int($t) || $t < 0 || ! is_int($view) || $view < 1 || $view > 10000 || $path === null) {
            return null;
        }

        $fields = match ($type) {
            'view' => ['previous' => self::path(data_get($event, 'from'), $paths)],
            'section' => self::section($event),
            'dwell' => self::dwell($event),
            'scroll' => self::scroll($event),
            'click' => self::pointed($event, ['href' => self::href(data_get($event, 'href'), $paths)]),
            'rage', 'dead' => self::pointed($event),
            'field', 'abandon' => self::field($event),
            'submit' => ['form' => Scrubber::text(data_get($event, 'form'), 100)],
            'custom' => self::custom($event),
        };

        if ($fields === null) {
            return null;
        }

        return [
            'type' => $type,
            't' => min($t, 86_400_000),
            'view' => $view,
            'path' => $path,
            ...$fields,
        ];
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>|null
     */
    private static function section(array $event): ?array
    {
        $section = Scrubber::text(data_get($event, 'section'), 100);
        $index = data_get($event, 'i');

        if ($section === null) {
            return null;
        }

        return ['section' => $section, 'section_index' => is_int($index) ? max(0, min(1000, $index)) : 0];
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>|null
     */
    private static function dwell(array $event): ?array
    {
        $value = data_get($event, 'value');

        if (! is_int($value) || $value < 1) {
            return null;
        }

        return ['section' => Scrubber::text(data_get($event, 'section'), 100), 'value' => min($value, 3_600_000)];
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>|null
     */
    private static function scroll(array $event): ?array
    {
        $value = data_get($event, 'value');

        if (! is_int($value) || $value < 10 || $value > 100 || $value % 10 !== 0) {
            return null;
        }

        return ['value' => $value];
    }

    /**
     * @param  array<string, mixed>  $event
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>|null
     */
    private static function pointed(array $event, array $extra = []): ?array
    {
        $target = Scrubber::text(data_get($event, 'target'), 100);

        if ($target === null) {
            return null;
        }

        return [
            'target' => $target,
            'section' => Scrubber::text(data_get($event, 'section'), 100),
            'x' => self::coordinate(data_get($event, 'x')),
            'y' => self::coordinate(data_get($event, 'y')),
            ...$extra,
        ];
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>|null
     */
    private static function field(array $event): ?array
    {
        $target = Scrubber::text(data_get($event, 'target'), 100);

        if ($target === null) {
            return null;
        }

        return ['target' => $target, 'form' => Scrubber::text(data_get($event, 'form'), 100)];
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>|null
     */
    private static function custom(array $event): ?array
    {
        $name = data_get($event, 'name');

        if (! is_string($name) || preg_match(self::NAME, $name) !== 1) {
            return null;
        }

        $props = [];

        foreach ((array) data_get($event, 'props', []) as $key => $value) {
            if (count($props) === 10) {
                break;
            }

            if (! is_string($key) || preg_match(self::PROP, $key) !== 1) {
                continue;
            }

            if (is_string($value)) {
                $props[$key] = Scrubber::text($value, 100);
            } elseif (is_int($value) || is_float($value) || is_bool($value) || $value === null) {
                $props[$key] = $value;
            }
        }

        return ['target' => $name, 'data' => $props];
    }

    private static function path(mixed $value, PathNormalizer $paths): ?string
    {
        return is_string($value) && str_starts_with($value, '/') ? $paths->normalize($value) : null;
    }

    private static function href(mixed $value, PathNormalizer $paths): ?string
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        if (str_starts_with($value, '/')) {
            return $paths->normalize($value);
        }

        if (str_starts_with($value, '#')) {
            $fragment = Scrubber::text(substr($value, 1), 100);

            return $fragment === null ? null : "#{$fragment}";
        }

        if (in_array($value, ['mailto:', 'tel:', 'sms:'], true)) {
            return $value;
        }

        return self::host($value);
    }

    private static function host(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $host = strtolower($value);

        return preg_match(self::HOST, $host) === 1 ? $host : null;
    }

    private static function coordinate(mixed $value): ?float
    {
        if (! is_int($value) && ! is_float($value)) {
            return null;
        }

        return $value < 0 || $value > 1 ? null : round((float) $value, 4);
    }
}
