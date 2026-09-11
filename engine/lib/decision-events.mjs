import { createHash } from 'node:crypto';
export function eventId(source, id) { return createHash('sha256').update(`${source}:${id}`).digest('hex').slice(0,24); }
export function changes(items, previous={}) {
  if (!previous || Array.isArray(previous) || typeof previous!=='object') throw new Error('Invalid history');
  // Keep only the current crawl in state, so the history file stays bounded (10-day window).
  const state={};
  const events=items.map(e=>{
    const version=createHash('sha256').update(JSON.stringify([e.title,e.evidence,e.stage,e.deadlineAt,e.conditions])).digest('hex');
    const change=previous[e.id]===version?'unchanged':previous[e.id]?'updated':'new';state[e.id]=version;
    return {...e,change};
  });
  return {events,state};
}
export function eligibility(event, profile={}, now=Date.now()) {
  if (['closed','withdrawn'].includes(event.stage) || (event.deadlineAt && Date.parse(event.deadlineAt)<=now)) return 'ineligible';
  if (event.stage==='draft') return 'unknown';
  const conditions=event.conditions||{};
  let unknown=!Object.keys(conditions).length;
  for(const [key,allowed] of Object.entries(conditions)) {
    if(profile[key]==null) unknown=true;
    else if(!allowed.includes(profile[key])) return 'ineligible';
  }
  return unknown?'unknown':'eligible';
}
