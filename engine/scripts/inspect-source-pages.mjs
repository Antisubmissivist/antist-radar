import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
for(const url of process.argv.slice(2)){
  const page=await browser.newPage();try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    console.log(JSON.stringify({url,title:await page.title(),text:(await page.locator('body').innerText()).slice(0,6500),inputs:await page.locator('input,button,form').evaluateAll(es=>es.map(e=>({tag:e.tagName,type:e.getAttribute('type'),name:e.getAttribute('name'),action:e.getAttribute('action'),text:e.tagName==='BUTTON'?e.textContent?.slice(0,100):null})))}));
  }catch(e){console.log(JSON.stringify({url,error:e.message}));}await page.close();
}await browser.close();
