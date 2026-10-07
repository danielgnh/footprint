// Serves the fixture pages and the built tracker, and plays the ingest
// endpoint: every batch posted to /footprint/events?run=<id> is kept raw
// under its run, so a spec reads back exactly what the browser sent, even
// from a pagehide beacon fired by a page that no longer exists.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.PORT ?? 4174);
const runs = new Map();

const files = {
    '/footprint.js': ['resources/dist/footprint.js', 'text/javascript'],
    '/lenis.js': ['node_modules/lenis/dist/lenis.min.js', 'text/javascript'],
};

function tracker(query) {
    const run = encodeURIComponent(query.get('run') ?? 'none');
    const fail = query.get('fail') ? `&fail=${encodeURIComponent(query.get('fail'))}` : '';
    const data = [`data-endpoint="/footprint/events?run=${run}${fail}"`];

    for (const key of ['sample', 'gpc', 'debug']) {
        if (query.has(key)) {
            data.push(`data-${key}="${query.get(key).replace(/"/g, '')}"`);
        }
    }

    return '<script>window.footprint=window.footprint||{q:[],track:function(){this.q.push([].slice.call(arguments))}};</script>'
        + `<script defer src="/footprint.js" ${data.join(' ')}></script>`;
}

createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    const run = url.searchParams.get('run') ?? 'none';

    if (request.method === 'POST' && url.pathname === '/footprint/events') {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
            const received = runs.get(run) ?? [];
            received.push({
                body,
                headers: {
                    'content-type': request.headers['content-type'] ?? null,
                    origin: request.headers.origin ?? null,
                    cookie: request.headers.cookie ?? null,
                    'sec-fetch-mode': request.headers['sec-fetch-mode'] ?? null,
                },
            });
            runs.set(run, received);
            response.writeHead(url.searchParams.get('fail') === '500' ? 500 : 204).end();
        });

        return;
    }

    if (url.pathname === '/_received') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(runs.get(run) ?? []));

        return;
    }

    if (files[url.pathname]) {
        const [file, type] = files[url.pathname];
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(readFileSync(`${root}/${file}`));

        return;
    }

    const page = url.pathname.split('/')[1] || 'index';
    const file = `${root}/tests/Browser/pages/${page}.html`;

    if (request.method !== 'GET' || !/^[a-z-]+$/.test(page) || !existsSync(file)) {
        response.writeHead(404).end('Not found');

        return;
    }

    const html = readFileSync(file, 'utf8').replace('{{tracker}}', tracker(url.searchParams)).replaceAll('{{run}}', encodeURIComponent(run));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
}).listen(port, () => console.log(`footprint fixtures on http://localhost:${port}`));
