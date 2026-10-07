import { defineConfig, devices } from '@playwright/test';

const fixtures = 4317;
const workbench = 4318;

export default defineConfig({
    testDir: 'tests/Browser',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: process.env.CI ? 2 : 6,
    timeout: 60_000,
    reporter: [['list']],
    use: {
        trace: 'retain-on-failure',
    },
    webServer: [
        {
            command: 'node tests/Browser/server.mjs',
            url: `http://localhost:${fixtures}/long`,
            env: { PORT: String(fixtures) },
            reuseExistingServer: !process.env.CI,
        },
        {
            command: `vendor/bin/testbench workbench:build && vendor/bin/testbench serve --port=${workbench}`,
            url: `http://localhost:${workbench}/smoke`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
        },
    ],
    projects: [
        ...[
            { name: 'chromium', device: 'Desktop Chrome' },
            { name: 'webkit', device: 'Desktop Safari' },
            { name: 'iphone', device: 'iPhone 15' },
            { name: 'pixel', device: 'Pixel 7' },
        ].map(({ name, device }) => ({
            name,
            testIgnore: /fullstack\.spec\.ts/,
            use: { ...devices[device], baseURL: `http://localhost:${fixtures}` },
        })),
        {
            name: 'fullstack',
            testMatch: /fullstack\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: `http://localhost:${workbench}`,
                // A beacon sent while a page unloads skips Playwright's UA override and
                // says HeadlessChrome, which the ingest endpoint rightly drops as a bot.
                launchOptions: { args: [`--user-agent=${devices['Desktop Chrome'].userAgent}`] },
            },
        },
    ],
});
