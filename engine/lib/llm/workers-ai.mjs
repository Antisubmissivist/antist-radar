import {LLMProvider} from './provider.mjs';
import {writeFile} from 'node:fs/promises';
export class WorkersAIProvider extends LLMProvider {
  constructor(config){super(config);this.name='workers-ai';this.model=config.model||'@cf/openai/gpt-oss-120b';}
  get isConfigured(){return !!(process.env.CLOUDFLARE_ACCOUNT_ID&&(process.env.CF_AI_TOKEN||process.env.CLOUDFLARE_API_TOKEN));}
  async complete(system,user,opts={}){
    const account=process.env.CLOUDFLARE_ACCOUNT_ID;
    const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${this.model}`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.CF_AI_TOKEN||process.env.CLOUDFLARE_API_TOKEN}`},
      body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:user}],max_tokens:Math.min(opts.maxTokens||16000,24000),temperature:0.2,response_format:{type:'json_object'}}),signal:AbortSignal.timeout(opts.timeout||240000)});
    if(!res.ok)throw new Error(`Workers AI request failed (${res.status})`);
    const d=await res.json();await writeFile('runs/ai-provider-response.json',JSON.stringify(d));
    if(!d.success)throw new Error(`Workers AI failed: ${(d.errors||[]).map(e=>e.code).join(',')}`);
    const result=d.result;const value=result.response||result.choices?.[0]?.message?.content||result.output_text||result.output?.flatMap(i=>i.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
    if(!value)throw new Error(`Workers AI returned no text; fields: ${Object.keys(result||{}).join(',')}`);
    return {text:typeof value==='string'?value:JSON.stringify(value),model:this.model,usage:result.usage||{},finishReason:result.finish_reason||result.choices?.[0]?.finish_reason||null};
  }
}
