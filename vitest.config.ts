import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        environmentOptions: {
            happyDOM: { url: 'https://example.test/start' },
        },
        include: ['tests/js/**/*.test.ts'],
        restoreMocks: true,
    },
});
