import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPrivateFree,resolveForecast,url,multilingual } from '../lib/radar-contract.mjs';
import {changes,eligibility} from '../lib/decision-events.mjs';
test('four independent poison families rejected',()=>{
  for(const p of [{password:'secret'},{note:'123456789:'+ 'a'.repeat(35)},{note:'person@example.com'},{positions:[{price:2}]}]) assert.throws(()=>assertPrivateFree(p));
  assert.doesNotThrow(()=>assertPrivateFree({source:'JVN',title:'Security update'}));
});
test('URL credentials, protocols, and missing native edition rejected',()=>{
  assert.throws(()=>url('javascript:alert(1)'));assert.throws(()=>url('https://x.test/?api_key=secret'));
  assert.throws(()=>multilingual({ja:'日本語',en:'English'}));
});
test('replay and deadline change',()=>{
  const e={id:'a',title:'Grant',stage:'open',deadlineAt:'2026-10-01T00:00:00Z',evidence:'original'};
  const a=changes([e]);assert.equal(changes([{...e,fetchedAt:'later'}],a.state).events[0].change,'unchanged');
  assert.equal(changes([{...e,deadlineAt:'2026-11-01T00:00:00Z'}],a.state).events[0].change,'updated');
  assert.throws(()=>changes([e],[]));
});
test('eligibility rejects expired and mismatched and preserves unknown',()=>{
  const e={stage:'open',conditions:{region:['Japan']}};
  assert.equal(eligibility(e,{region:'France'}),'ineligible');assert.equal(eligibility(e,{}),'unknown');
  assert.equal(eligibility({...e,stage:'draft'},{region:'Japan'}),'unknown');
  assert.equal(eligibility({...e,deadlineAt:'2000-01-01T00:00:00Z'},{region:'Japan'}),'ineligible');
});
test('resolver requires fresh post-deadline evidence and is falsifiable',()=>{
  const f={symbol:'BTC-USD',baseline:100,direction:'above',dueAt:'2026-09-11T00:00:00Z'};
  const now=Date.parse('2026-09-11T00:10:00Z');
  assert.equal(resolveForecast(f,[{symbol:f.symbol,price:110,at:'2026-09-10T23:59:00Z'}],now),null);
  assert.equal(resolveForecast(f,[{symbol:f.symbol,price:110,at:'2026-09-11T00:01:00Z'}],now).status,'hit');
  assert.equal(resolveForecast(f,[{symbol:f.symbol,price:90,at:'2026-09-11T00:01:00Z'}],now).status,'miss');
  assert.equal(resolveForecast(f,[{symbol:f.symbol,price:110,at:'2026-09-11T00:11:00Z'}],now),null);
  assert.equal(resolveForecast(f,[{symbol:f.symbol,price:NaN,at:'2026-09-11T00:01:00Z'}],now),null);
  assert.equal(resolveForecast(f,[{symbol:f.symbol,price:110,at:'2026-09-11T00:09:00Z'},{symbol:f.symbol,price:90,at:'2026-09-11T00:01:00Z'}],now).status,'miss');
});
