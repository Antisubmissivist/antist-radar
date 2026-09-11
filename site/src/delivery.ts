// Telegram delivery for the Worker. The message body is built by the shared,
// model-free builder in engine/lib/radar-digest.mjs (also used by the Actions
// script), then sent as a rich message (collapsible blocks + tables).

import { buildMarkdown } from '../../engine/lib/radar-digest.mjs';
export { buildMarkdown } from '../../engine/lib/radar-digest.mjs';

type DeliveryEnv = { DB: D1Database; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; TELEGRAM_THREAD_ID?: string };
type Lang = 'ja' | 'en' | 'zh';

async function sendRich(env: DeliveryEnv, markdown: string): Promise<void> {
  const body: Record<string, unknown> = { chat_id: env.TELEGRAM_CHAT_ID, rich_message: { markdown } };
  if (env.TELEGRAM_THREAD_ID) body.message_thread_id = Number(env.TELEGRAM_THREAD_ID);
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendRichMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const d = await r.json() as { ok: boolean; result?: { message_id: number; chat: { id: number } } };
  if (!r.ok || !d.ok) throw new Error('Rich delivery not confirmed');
  if (String(d.result?.chat.id) !== String(env.TELEGRAM_CHAT_ID)) throw new Error('Delivery target mismatch');
}

export async function sendDigest(env: DeliveryEnv, s: unknown, at = Date.now(), opts: { force?: boolean; lang?: Lang } = {}) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { status: 'unconfigured' };
  const lang = opts.lang || 'zh';
  const generatedAt = String((s as { generatedAt?: string }).generatedAt || '');
  if (!opts.force && generatedAt && at - Date.parse(generatedAt) > 90 * 60000) return { status: 'stale' };
  const date = new Date(at + 9 * 3600000).toISOString().slice(0, 10);
  const id = opts.force ? `test:${Date.now()}` : `daily:${date}`;
  const reserved = await env.DB.prepare('INSERT OR IGNORE INTO deliveries (id,state,created_at,message_ids) VALUES (?,?,?,?)').bind(id, 'sending', new Date(at).toISOString(), '[]').run();
  if (!reserved.meta.changes) return { status: 'already-attempted', id };
  try {
    await sendRich(env, buildMarkdown(s, lang));
    await env.DB.prepare('UPDATE deliveries SET state=? WHERE id=?').bind('sent', id).run();
    return { status: 'sent', id, lang };
  } catch {
    await env.DB.prepare('UPDATE deliveries SET state=? WHERE id=?').bind('uncertain', id).run();
    return { status: 'uncertain', id };
  }
}
