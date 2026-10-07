import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 6 * 1024;
const file = new URL('../resources/dist/footprint.js', import.meta.url);
const source = readFileSync(file);
const gzipped = gzipSync(source, { level: 9 }).length;

console.log(`footprint.js: ${source.length} B, ${gzipped} B gzipped (budget ${BUDGET} B)`);

if (gzipped > BUDGET) {
    console.error('Over budget.');
    process.exit(1);
}
