import { test, expect } from '@playwright/test';

test('landing is public while console and mutations retain operator authority', async () => {
  const root = await fetch('http://127.0.0.1:3018/');
  expect(root.status).toBe(200);
  expect(await root.text()).toContain('A safe fix can become a risky combination.');
  for (const path of ['/overview','/incidents','/admin','/v1/runs']) {
    expect((await fetch('http://127.0.0.1:3018'+path)).status).toBe(401);
  }
  expect((await fetch('http://127.0.0.1:3018/',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(401);
});

test('landing fits desktop and mobile and connects to the authenticated console', async ({page}) => {
  const errors: string[] = [];
  const backendRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/v1/')) backendRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto('/');
    await expect(page.locator('.app-frame')).toHaveCount(0);
    await expect(page.getByRole('heading',{level:1})).toHaveText('A safe fix can become a risky combination.');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    if (width < 861) {
      const menu = page.getByRole('button',{name:'Open menu',exact:true});
      await menu.click();
      await expect(page.getByRole('navigation',{name:'Primary'})).toBeVisible();
      await page.getByRole('navigation',{name:'Primary'}).getByRole('link',{name:'Evidence',exact:true}).click();
      await expect(page.getByRole('button',{name:'Open menu',exact:true})).toHaveAttribute('aria-expanded','false');
      await expect(page).toHaveURL(/#evidence$/);
    }
    await expect(page.locator('.lp-card')).toHaveCSS('opacity','1');
    await page.screenshot({path:`../../scratch/screenshots/landing-${width}.png`,fullPage:true});
  }
  expect(backendRequests).toEqual([]);
  await page.getByRole('link',{name:'Open the console',exact:true}).first().click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.locator('.console-page')).toHaveCSS('overflow','hidden');
  await page.getByRole('link',{name:'Cascade Zero project home',exact:true}).click();
  await expect(page).toHaveURL('http://127.0.0.1:3018/');
  await expect(page.locator('.app-frame')).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('overflow-y','auto');
  expect(errors).toEqual([]);
});
