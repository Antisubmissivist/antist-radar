// Fail closed on observable violations; this is not a substitute for source review.
export function validateEditorial(value, {title=false}={}) {
  for (const lang of ['ja','en','zh']) {
    const s=value?.[lang];
    if(typeof s!=='string'||!s.trim())throw new Error('Missing native editorial field');
    // Numerical facts belong to collector fields. The editor may retain a release
    // version in a title, but must not manufacture dates, amounts or probabilities.
    if(!title&&/[0-9０-９]/u.test(s))throw new Error('Numerical editorial claim requires structured evidence');
    if(lang==='ja'&&/[\uac00-\ud7af]|本周|事业|半导体|主办|关注|开设|详细|现状|申请|进行|针对/u.test(s))throw new Error('Japanese language contamination');
    if(lang==='en'&&/[\u3040-\u30ff\uac00-\ud7af]/u.test(s))throw new Error('English language contamination');
  }
  return value;
}
