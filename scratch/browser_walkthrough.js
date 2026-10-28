const {chromium, expect} = require('../frontend/app/node_modules/@playwright/test');
const fs = require('fs');
const base = process.env.CONSOLE_URL || 'http://127.0.0.1:3000';
const output = __dirname + '/screenshots';
const {spawn} = require('child_process');
const path = require('path');
const children = [];
if (process.env.CONSOLE_START === '1') {
  const root = path.resolve(__dirname, '..');
  children.push(spawn(path.join(root,'.venv/bin/python'), ['-m','backend.api'], {cwd:root, env:{...process.env,CASCADE_DATA_DIR:'/tmp/cascade-walkthrough-data',CASCADE_APPROVAL_TOKEN:'local-console-test',GEMINI_API_KEY:''}, stdio:'ignore'}));
  children.push(spawn(process.execPath, ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1'], {cwd:path.join(root,'frontend/app'), env:{...process.env,CASCADE_APPROVAL_TOKEN:'local-console-test',CASCADE_OPERATOR_PASSWORD:'local-console-pass'}, stdio:'ignore'}));
}
const cleanup = () => children.forEach(child=>child.kill());
process.on('exit',cleanup);

(async () => {
  if (children.length) {
    let ready = false;
    for(let i=0;i<60;i++) {
      try { await fetch(base+'/incidents', {signal:AbortSignal.timeout(2000)}); await fetch('http://127.0.0.1:8000/v1/health', {signal:AbortSignal.timeout(2000)}); ready=true; break; } catch {}
      await new Promise(r=>setTimeout(r,500));
    }
    if(!ready) throw new Error('Local servers did not start');
  }
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  const context = await browser.newContext({httpCredentials:{username:'operator', password:process.env.CONSOLE_PASSWORD || 'local-console-pass'},viewport:{width:1920,height:1080}});
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error' || m.type()==='warning') errors.push(m.type()+': '+m.text());});
  page.on('response',r=>{if(r.url().includes('/v1/')) requests.push({url:r.url(),status:r.status()});});
  await page.goto(base+'/incidents');
  await expect(page.getByRole('heading',{name:'Incident cockpit'})).toBeVisible();
  await page.getByLabel('Policy',{exact:true}).selectOption('coordinated');
  await page.getByRole('button',{name:'💥 DB Saturation',exact:true}).click();
  await expect(page.locator('.metric-ribbon')).toBeVisible({timeout:30000});
  await expect(page.locator('.heading-actions .status-pill')).toHaveText('completed',{timeout:30000});
  const runLink = await page.getByRole('link',{name:'Review plans →',exact:true}).getAttribute('href');
  const id = runLink.split('/').at(-1);
  fs.writeFileSync(__dirname+'/run-id.txt',id);
  await page.goto(base+'/experiments?run='+id);
  await page.getByRole('button',{name:'Compare policies',exact:true}).click();
  await expect(page.getByRole('table',{name:'Policy comparison'}).getByText('Not run')).toHaveCount(0,{timeout:60000});
  const views = [['overview','/overview'],['incidents','/incidents'],['incident-detail','/incidents/'+id],['plans','/plans/'+id],['experiments','/experiments?run='+id],['audit','/audit?run='+id],['admin','/admin']];
  const results = [];
  for (const size of [{width:1920,height:1080},{width:2560,height:1440}]) {
    await page.setViewportSize(size);
    for (const [name,path] of views) {
      await page.goto(base+path); await expect(page.locator('.console-page')).toBeVisible();
      await expect(page.getByText('Loading backend records…')).toHaveCount(0,{timeout:30000});
      if(name==='admin') await expect(page.getByText('Loading system status…')).toHaveCount(0);
      await page.waitForTimeout(700);
      const layout = await page.evaluate(() => {
        const main = document.querySelector('.app-main-content'), root = document.querySelector('.console-page');
        return {documentHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,mainOverflow:main.scrollHeight-main.clientHeight,pageOverflow:root.scrollHeight-root.clientHeight,pageBottom:root.getBoundingClientRect().bottom};
      });
      await page.screenshot({path:`${output}/${name}-${size.height}.png`,fullPage:true});
      results.push({view:name,...size,...layout});
      if(layout.documentHeight>size.height || layout.documentWidth>size.width || layout.mainOverflow>1 || layout.pageOverflow>1 || layout.pageBottom>size.height) throw new Error('Viewport overflow '+JSON.stringify(results.at(-1)));
    }
  }
  await page.goto(base+'/plans/'+id);
  await page.getByLabel('Operator decision rationale').fill('Reviewed simulator evidence');
  await page.getByRole('button',{name:'Approve Plan Replay',exact:false}).click();
  await expect(page.getByText('Plan Approved by Authenticated Operator')).toBeVisible();
  await page.screenshot({path:output+'/plans-approved-1440.png',fullPage:true});
  await page.goto(base+'/audit?run='+id);
  await page.getByLabel('Type',{exact:true}).selectOption('verification');
  await expect(page.locator('.receipt-fields')).toContainText('HMAC-SHA256');
  await page.screenshot({path:output+'/audit-signed-1440.png',fullPage:true});
  if(errors.length) throw new Error('Browser errors: '+JSON.stringify(errors));
  fs.writeFileSync(__dirname+'/verification.json',JSON.stringify({results,errors,requests},null,2));
  console.log(JSON.stringify({results,errors,requests:requests.length},null,2));
  await browser.close(); cleanup();
})().catch(e=>{console.error(e);process.exit(1)});
