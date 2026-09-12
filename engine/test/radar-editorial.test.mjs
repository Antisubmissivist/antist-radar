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
  assert.doesNotThrow(()=>validateEditorial({ja:'創業2年の新興企業。',en:'A two-year-old startup.',zh:'成立2年的初创公司。'},{evidence:'The round for the two-year-old startup is closing.'}));
  assert.doesNotThrow(()=>validateEditorial({ja:'約20万円の不正利用。',en:'Fraudulent charges of about 200,000 yen.',zh:'约20万日元的盗刷。'},{evidence:'ネットショッピングで約20万円の利用を知らせるメールが届いた。'}));
  assert.throws(()=>validateEditorial({ja:'999人の被害。',en:'999 victims affected.',zh:'999名受害者。'},{evidence:'ネットショッピングで約20万円の利用を知らせるメールが届いた。'}));
});
