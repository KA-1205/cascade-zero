import { test, expect } from '@playwright/test';

test('anonymous requests cannot exercise operator authority', async () => {
  for (const url of ['/overview', '/v1/runs', '/api/approval/not-a-plan', '/api/backtest/not-a-plan']) {
    const response = await fetch(`http://127.0.0.1:3018${url}`);
    expect(response.status).toBe(401);
    const write = await fetch(`http://127.0.0.1:3018${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(write.status).toBe(401);
  }
});

test('operator review preserves context, paginates, and records decisions', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/incidents');
  await page.getByRole('spinbutton').fill('137');
  await page.getByRole('button', { name: 'Generate incident' }).click();
  await expect(page.getByRole('heading', { name: 'Incident Replay' })).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveValue('137');
  const runId = page.url().split('/').at(-1)!;
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('incident.png') });
  await expect(page.locator('header')).toContainText(runId.slice(0, 8));
  await page.getByRole('link', { name: 'Review candidate plans' }).click();
  await expect(page.getByRole('button', { name: 'Approve plan' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Send to Experiment Lab' }).first().click();
  await page.getByRole('button', { name: 'Run synthetic replay' }).click();
  await expect(page.getByText('LAB REPLAY:', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Run comparison on this seed' }).click();
  await expect(page.getByRole('table', { name: 'Policy comparison' })).toBeVisible();
  await expect(page.getByTestId('comparison-context')).toContainText('Seed 137');
  await expect(page.getByRole('table', { name: 'Policy comparison' })).toContainText('Rule fallback');
  await page.getByRole('link', { name: 'Return to operator review' }).click();
  await page.getByRole('button', { name: 'Approve plan' }).first().click();
  await expect(page.getByText('APPROVED', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reject', exact: true }).first().click();
  await expect(page.getByText('REJECTED', { exact: true }).first()).toBeVisible();
  await page.goto(`/audit?run=${runId}`);
  await page.getByRole('combobox', { name: 'Event type' }).selectOption('verification');
  await expect(page.locator('summary').filter({ hasText: 'verification' })).toHaveCount(2);
  const response = await request.post('/v1/runs', { data: { seed: 137, scenario: 'db_slowdown', policy: 'coordinated', purpose: 'operator_review' } });
  const longRun = await response.json();
  await page.goto(`/plans/${longRun.id}`);
  await page.getByRole('button', { name: 'Next plans' }).click();
  await expect(page.getByText(/Plans 13–/)).toBeVisible();
  await page.getByRole('button', { name: 'Previous plans' }).click();
  await expect(page.getByText(/Plans 1–12/)).toBeVisible();
  await page.goto(`/experiments?run=${runId}&plan=missing-plan`);
  await expect(page.getByRole('alert').filter({ hasText: 'Requested plan not found' })).toBeVisible();
  await page.goto('/incidents/not-a-real-run');
  await expect(page.locator('main').getByRole('alert')).toContainText('not found');
  await expect(page.locator('main').getByText(`Run ${runId.slice(0, 8)}`, { exact: false })).toHaveCount(0);
  const bad = await request.post('/v1/runs', { data: { seed: 1, scenario: [], policy: 'none' } });
  expect(bad.status()).toBe(400);
  const crossOrigin = await request.post('/v1/runs', { headers: { Origin: 'https://other.invalid' },
    data: { seed: 1, scenario: 'db_slowdown', policy: 'none' } });
  expect(crossOrigin.status()).toBe(403);
  expect(errors).toEqual([]);
});

test('desktop routes render without overflow or page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: 'Simulate an incident' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`incidents-${width}.png`) });
  }
  for (const route of ['/', '/overview', '/plans', '/experiments', '/audit', '/admin']) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('header')).toContainText('Simulator connected');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
