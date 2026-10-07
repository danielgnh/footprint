<?php

namespace Danielgnh\Footprint\Ingest;

use Danielgnh\Footprint\Models\Footprint;
use Danielgnh\Footprint\Models\Visit;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\ConnectionResolverInterface;

final readonly class Recorder
{
    public function __construct(private ConnectionResolverInterface $db) {}

    public function record(Payload $payload, string $host): void
    {
        if ($payload->events === []) {
            return;
        }

        $visit = $payload->visit;
        $now = now();
        $connection = $this->db->connection(config('footprint.connection'));
        $views = count(array_filter($payload->events, fn (array $event): bool => $event['type'] === 'view'));
        $entry = collect($payload->events)->firstWhere('type', 'view') ?? $payload->events[0];

        $rows = array_map(fn (array $event): array => [
            'visit_id' => $visit['id'],
            'view' => $event['view'],
            't' => $event['t'],
            'host' => $host,
            'path' => $event['path'],
            'type' => $event['type'],
            'section' => data_get($event, 'section'),
            'section_index' => data_get($event, 'section_index'),
            'target' => data_get($event, 'target'),
            'href' => data_get($event, 'href'),
            'previous' => data_get($event, 'previous'),
            'form' => data_get($event, 'form'),
            'x' => data_get($event, 'x'),
            'y' => data_get($event, 'y'),
            'value' => data_get($event, 'value'),
            'data' => array_key_exists('data', $event) ? json_encode($event['data'], JSON_FORCE_OBJECT | JSON_THROW_ON_ERROR) : null,
            'created_at' => $now,
        ], $payload->events);

        $connection->transaction(function (ConnectionInterface $connection) use ($visit, $host, $now, $views, $entry, $rows): void {
            $connection->table((new Visit)->getTable())->insertOrIgnore([
                'id' => $visit['id'],
                'host' => $host,
                'entry_path' => $entry['path'],
                'referrer_host' => $visit['ref'],
                'utm_source' => data_get($visit, 'utm.source'),
                'utm_medium' => data_get($visit, 'utm.medium'),
                'utm_campaign' => data_get($visit, 'utm.campaign'),
                'utm_content' => data_get($visit, 'utm.content'),
                'device' => $visit['device'],
                'viewport' => $visit['vw'],
                'lang' => $visit['lang'],
                'views' => 0,
                'events' => 0,
                'started_at' => $now,
                'ended_at' => $now,
            ]);

            $connection->table((new Visit)->getTable())->where('id', $visit['id'])->incrementEach(
                ['views' => $views, 'events' => count($rows)],
                ['ended_at' => $now],
            );

            foreach (array_chunk($rows, 100) as $chunk) {
                $connection->table((new Footprint)->getTable())->insert($chunk);
            }
        });
    }
}
