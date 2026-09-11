import '../apis/utils/env.mjs';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
try{
  await page.goto('https://acleddata.com/user/login',{waitUntil:'domcontentloaded'});
  const decline=page.getByRole('button',{name:'Decline',exact:true});if(await decline.isVisible())await decline.click();
  await page.getByRole('button',{name:'Login with email',exact:true}).click();
  await page.locator('input[name="name"]').fill(process.env.ACLED_EMAIL);
  await page.locator('input[name="pass"]').fill(process.env.ACLED_PASSWORD);
  const form=page.locator('form').filter({has:page.locator('input[name="pass"]')});
  await Promise.all([page.waitForLoadState('networkidle'),form.locator('input[type="submit"]').click()]);
  const body=await page.locator('body').innerText();await writeFile('runs/acled-account-page.txt',body);
  await page.context().storageState({path:'runs/acled-session.json'});
  console.log(JSON.stringify({url:page.url(),title:await page.title(),conditions:body.split('\n').filter(x=>/agree|terms|access|subscription|plan|denied|error|invalid|verification|reactivat/i.test(x)).slice(0,30),links:await page.locator('a').evaluateAll(es=>es.filter(e=>/terms|access|subscription|plan/i.test(e.textContent)).map(e=>({text:e.textContent.trim().slice(0,80),url:e.href})).slice(0,15))}));
}finally{await browser.close();}
