import { defineConfig } from 'vite';

export default defineConfig({
    publicDir: false,
    build: {
        outDir: 'resources/dist',
        emptyOutDir: true,
        target: 'es2020',
        lib: {
            entry: 'resources/js/tracker/index.ts',
            formats: ['iife'],
            name: 'footprintTracker',
            fileName: () => 'footprint.js',
        },
    },
});
