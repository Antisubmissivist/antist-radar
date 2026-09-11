import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEditorial} from '../lib/radar-editorial.mjs';
test('editorial rejects observed cross-language contamination and narrative numbers',()=>{
  const text={ja:'適用条件は原文で確認してください。',en:'Check the original eligibility requirements.',zh:'先核对原文中的申请条件。'};
  assert.doesNotThrow(()=>validateEditorial(text));
  for(const ja of ['事業所を开设する','事前に 문의','上限50万円','９月末まで'])assert.throws(()=>validateEditorial({...text,ja}));
  assert.throws(()=>validateEditorial({...text,en:''}));
  assert.throws(()=>validateEditorial({...text,en:'Apply by September 30.'}));
  assert.doesNotThrow(()=>validateEditorial({ja:'Hono v4.13.7',en:'Hono v4.13.7',zh:'Hono v4.13.7'},{title:true}));
});
