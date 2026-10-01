import test from 'node:test';
import assert from 'node:assert/strict';
import {parseJson,scrubFields} from '../lib/radar-analysis.mjs';
import {validateEditorial} from '../lib/radar-editorial.mjs';

test('M3 extra closing brace does not discard a complete multilingual object',()=>{
  const obj={ja:{items:[{id:'a',title:'Quoted "word" and } brace'}]},en:{items:[{id:'a'}]},zh:{items:[{id:'a'}]}};
  assert.deepEqual(parseJson(JSON.stringify(obj)+'}'),obj);
});
test('repair missing comma without changing the model text or evidence ID',()=>{
  assert.deepEqual(parseJson('{"id":"a" "summary":"original text"}'),{id:'a',summary:'original text'});
});
test('truncated or non-JSON answer still fails closed',()=>{
  assert.throws(()=>parseJson('{"ja":{"items":['),/Truncated/);
  assert.throws(()=>parseJson('Sorry, no answer'),/No JSON/);
});
test('unsupported number remains rejected after syntax repair',()=>{
  const j=parseJson('{"ja":"999人" "en":"999 people","zh":"999人"}');
  assert.throws(()=>validateEditorial(j,{evidence:'No numerical evidence'}),/Unverified numerical/);
});
test('numeric take is removed in every language while news text survives',()=>{
  const lanes={ja:[{id:'a',title:'見出し',summary:'本文',action:'このM3には長い評価がある。',audience:'',unknowns:''}],en:[{id:'a',action:'A useful tool in the workshop.',audience:'',unknowns:''}],zh:[{id:'a',action:'这是工具箱里的一把工具，值得检验。',audience:'',unknowns:''}]};
  scrubFields(lanes);
  assert.equal(lanes.ja[0].title,'見出し');
  assert.equal(lanes.ja[0].summary,'本文');
  for(const l of ['ja','en','zh'])assert.equal(lanes[l][0].action,'');
});
