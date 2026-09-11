type DeliveryEnv={DB:D1Database;TELEGRAM_BOT_TOKEN?:string;TELEGRAM_CHAT_ID?:string};
type Digest={id:string;generatedAt:string;digest:{zh:string};events:{change:string;title:{zh:string};action:{zh:string};url:string}[]};
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function digestText(s:Digest){
  const items=s.events.filter(e=>e.change!=='unchanged').slice(0,4);
  let body=`<b>Antist Radar · 今日简报</b>\n${escape(s.digest.zh.slice(0,500))}\n`;
  for(const e of items){const row=`\n<b>${escape(e.title.zh.slice(0,100))}</b>\n${escape(e.action.zh.slice(0,150))}\n<a href="${escape(e.url)}">原文</a>\n`;if(body.length+row.length<3300)body+=row;}
  if(!items.length)body+='\n本轮没有新增或变更的行动事项。\n';
  return body+`\n<a href="https://radar.antist.ai/zh">完整简报与预测记录</a>\n更新：${escape(s.generatedAt)}`;
}
export async function sendDigest(env:DeliveryEnv,s:Digest,at=Date.now()){
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return {status:'unconfigured'};
  if(at-Date.parse(s.generatedAt)>90*60000)return {status:'stale'};
  const date=new Date(at+9*3600000).toISOString().slice(0,10);const id=`daily:${date}`;
  const reserved=await env.DB.prepare('INSERT OR IGNORE INTO deliveries (id,state,created_at,message_ids) VALUES (?,?,?,?)').bind(id,'sending',new Date(at).toISOString(),'[]').run();
  if(!reserved.meta.changes)return {status:'already-attempted',id};
  // A transport failure may mean Telegram accepted the message. Never retry an
  // uncertain send automatically, and never log a URL containing the bot token.
  try{
    const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:digestText(s),parse_mode:'HTML',link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});
    const d=await r.json() as {ok:boolean;result?:{message_id:number;chat:{id:number}}};
    if(!r.ok||!d.ok||String(d.result?.chat.id)!==env.TELEGRAM_CHAT_ID)throw new Error('Delivery not confirmed');
    await env.DB.prepare('UPDATE deliveries SET state=?,message_ids=? WHERE id=?').bind('sent',JSON.stringify([d.result!.message_id]),id).run();
    return {status:'sent',id,messageId:d.result!.message_id};
  }catch{await env.DB.prepare('UPDATE deliveries SET state=? WHERE id=?').bind('uncertain',id).run();return {status:'uncertain',id};}
}
