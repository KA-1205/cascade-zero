import { test, expect } from '@playwright/test';

test('anonymous and cross-origin requests cannot exercise authority', async ({ request }) => {
  for (const url of ['/overview', '/v1/runs', '/v1/plans/not-a-plan/approval']) {
    const response = await fetch(`http://127.0.0.1:3018${url}`);
    expect(response.status).toBe(401);
  }
  const invalid = await request.post('/v1/runs', { data: {seed:1,scenario:[],policy:'none'} });
  expect(invalid.status()).toBe(400);
  const crossOrigin = await request.post('/v1/runs', {headers:{Origin:'https://other.invalid'},data:{seed:1,scenario:'db_slowdown',policy:'none'}});
  expect(crossOrigin.status()).toBe(403);
});

test('operator can stream, replay, compare, approve once, and inspect a signed receipt', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/incidents');
  await page.getByLabel('Simulation seed').fill('137');
  await page.getByLabel('Policy', {exact:true}).selectOption('coordinated');
  await page.getByRole('button', {name:'Generate incident',exact:true}).click();
  await expect(page.locator('.heading-actions .status-pill')).toHaveText('running');
  await expect(page.locator('.heading-actions .status-pill')).toHaveText('completed', {timeout:30000});
  await expect(page.locator('.stream-status')).toContainText('SSE');
  await page.getByRole('button',{name:'Pause live stream'}).click();
  await expect(page.locator('.stream-status')).toContainText('Stream paused');
  await page.getByRole('button',{name:'Resume live stream'}).click();
  const plansLink = page.getByRole('link',{name:'Review plans →',exact:true});
  const href = (await plansLink.getAttribute('href'))!;
  const runId = href.split('/').at(-1)!;
  await plansLink.click();
  await page.locator('.plans-scroll-list .plan-item-row').last().click();
  await expect(page.getByRole('button',{name:'Approve Plan Replay',exact:false})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Reject',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Simulate What-If Impact'}).click();
  await expect(page.getByText('LAB REPLAY:',{exact:false})).toBeVisible();
  await page.getByRole('link',{name:'Open in Experiment Lab →'}).click();
  await page.getByRole('button',{name:'Compare policies',exact:true}).click();
  await expect(page.getByRole('table',{name:'Policy comparison'}).getByText('Not run')).toHaveCount(0,{timeout:60000});
  await page.goto(href);
  await page.getByLabel('Operator decision rationale').fill('Reviewed measured replay outcomes');
  await page.getByRole('button',{name:'Approve Plan Replay',exact:false}).click();
  await expect(page.getByText('Plan Approved by Authenticated Operator')).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve Plan Replay',exact:false})).toHaveCount(0);
  await expect(page.locator('.plans-scroll-list .status-superseded').first()).toBeVisible();
  await page.locator('.plans-scroll-list .plan-item-row').filter({hasText:'SUPERSEDED'}).first().click();
  await expect(page.getByText('Incident Run Decided',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Simulate What-If Impact'})).toBeVisible();
  await page.goto(`/audit?run=${runId}`);
  await page.getByLabel('Type',{exact:true}).selectOption('verification');
  await expect(page.locator('.receipt-fields')).toContainText('HMAC-SHA256');
  await expect(page.locator('.receipt-fields')).toContainText('authenticated-operator');
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill('does-not-exist');
  await expect(page.getByText('No matching events.')).toBeVisible();
  await page.goto('/incidents/not-a-real-run');
  await expect(page.locator('main').getByRole('alert')).toContainText('not found');
  expect(errors).toEqual([]);
});

test('all desktop views contain their page and main scrollers', async ({ page, request }) => {
  const response = await request.post('/v1/runs',{data:{seed:42,scenario:'traffic_surge',policy:'coordinated',purpose:'operator_review'}});
  const run = await response.json();
  for (const viewport of [{width:1920,height:1080},{width:2560,height:1440}]) {
    await page.setViewportSize(viewport);
    for (const route of ['/overview','/incidents',`/incidents/${run.id}`,`/plans/${run.id}`,`/experiments?run=${run.id}`,`/audit?run=${run.id}`,'/admin']) {
      await page.goto(route);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('.console-page')).toHaveCSS('display', 'flex');
      if (route.startsWith('/experiments')) {
        await expect(page.locator('.master-detail')).toHaveCSS('display', 'grid');
        await expect(page.locator('.master-row').first()).toHaveCSS('display', 'flex');
        await expect(page.locator('.master-pane .pane-scroll')).toHaveCSS('overflow-y', 'auto');
        await expect(page.getByLabel('Model execution evidence')).toContainText('no model requested');
      }
      await expect(page.getByText('Loading backend records…')).toHaveCount(0);
      const overflow = await page.evaluate(() => {
        return [document.documentElement,document.querySelector('.app-main-content')!,document.querySelector('.console-page')!].map(el=>({x:el.scrollWidth-el.clientWidth,y:el.scrollHeight-el.clientHeight}));
      });
      for (const item of overflow) { expect(item.x).toBeLessThanOrEqual(1); expect(item.y).toBeLessThanOrEqual(1); }
    }
  }
});


test('payments streams ticks and exposes scored combinations during the run', async ({page}) => {
  test.setTimeout(45000);
  await page.goto('/incidents');
  await page.getByLabel('Policy',{exact:true}).selectOption('coordinated');
  await page.getByRole('button',{name:'💳 Payments',exact:true}).click();
  await expect(page.locator('.heading-actions .status-pill')).toHaveText('running');
  const first = await page.locator('.stream-status').innerText();
  await expect.poll(()=>page.locator('.stream-status').innerText(),{timeout:10000}).not.toBe(first);
  await page.getByRole('link',{name:'Review plans →',exact:true}).click();
  await expect(page.getByRole('table',{name:'Evaluated action combinations'})).toBeVisible({timeout:20000});
  await expect(page.locator('.heading-actions .status-pill')).toHaveText('running');
  await expect(page.getByRole('table',{name:'Evaluated action combinations'}).locator('tbody tr')).not.toHaveCount(1);
});
