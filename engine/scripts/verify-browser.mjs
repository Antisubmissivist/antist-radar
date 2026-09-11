import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.RADAR_BROWSER_URL||'http://127.0.0.1:8787';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('runs',{recursive:true});const report=[];
for(const l of ['ja','en','zh']){
  await page.goto(origin+'/'+l,{waitUntil:'networkidle'});
  assert.equal(await page.locator('html').getAttribute('lang'),l);
  assert.ok(await page.locator('[data-event]').count()>0);
  await page.locator('[data-search]').fill('zzzz-no-matching-story');
  assert.ok(await page.locator('[data-no-results]').isVisible());
  await page.locator('[data-search]').fill('');
  await page.locator('details summary').first().click();assert.ok(await page.locator('details[open]').count()>0);
  const theme=await page.locator('html').getAttribute('class');await page.locator('[data-theme]').click();await page.reload();assert.notEqual(await page.locator('html').getAttribute('class'),theme);
  await page.screenshot({path:`runs/radar-${l}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert.ok(fits,`${l} mobile overflow`);
  await page.screenshot({path:`runs/radar-${l}-mobile.png`,fullPage:true});
  report.push({locale:l,events:await page.locator('[data-event]').count(),mobileFits:fits});await page.setViewportSize({width:1440,height:1000});
}
assert.deepEqual(errors,[]);await writeFile('runs/browser-verification.json',JSON.stringify({at:new Date().toISOString(),origin,report,errors},null,2));await browser.close();console.log(JSON.stringify({verified:true,origin,report}));
