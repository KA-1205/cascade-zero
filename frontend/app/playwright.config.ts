import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', workers: 1, fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3018', viewport: { width: 1440, height: 900 },
    httpCredentials: { username: 'operator', password: 'test-operator-password', send: 'always' },
    launchOptions: process.env.CHROMIUM_EXECUTABLE ? {
      executablePath: process.env.CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader'],
    } : {},
  },
  webServer: [
    { command: 'python -m backend.api', cwd: '../..', port: 8018,
      env: { CASCADE_APPROVAL_TOKEN: 'browser-test-token', CASCADE_REQUIRE_AUTH: 'true', GEMINI_API_KEY: '', PORT: '8018', CASCADE_DATA_DIR: '/tmp/cascade-console-e2e' } },
    { command: 'npm run start -- --hostname 127.0.0.1 --port 3018', port: 3018,
      env: { CASCADE_OPERATOR_PASSWORD: 'test-operator-password', CASCADE_APPROVAL_TOKEN: 'browser-test-token', CASCADE_API_ORIGIN: 'http://127.0.0.1:8018' } },
  ],
});
