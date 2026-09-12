const NUMBER_WORDS = {
  zero: 0, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3,
  four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6,
  seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9,
  ten: 10, tenth: 10, eleven: 11, twelve: 12, twelfth: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

const KANJI_DIGITS = {
  '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
};

export function normalizeEvidence(evidence) {
  let ev = String(evidence || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const uncomma = ev.replace(/(?<=\d),(?=\d)/g, '');
  let expanded = ev + ' ' + uncomma;

  for (const [w, val] of Object.entries(NUMBER_WORDS)) {
    const re = new RegExp(`(?:^|[^a-zA-Z])${w}(?:[^a-zA-Z]|$)`, 'i');
    if (re.test(ev)) expanded += ` ${val} `;
  }

  for (const [k, val] of Object.entries(KANJI_DIGITS)) {
    if (ev.includes(k)) expanded += ` ${val} `;
  }

  for (const match of ev.matchAll(/(\d+(?:\.\d+)?)\s*(?:万|萬)/g)) {
    const n = parseFloat(match[1]) * 10000;
    expanded += ` ${n} ${n.toLocaleString('en-US')} `;
  }

  for (const match of ev.matchAll(/(\d+(?:\.\d+)?)\s*(?:亿|億)/g)) {
    const n = parseFloat(match[1]) * 100000000;
    expanded += ` ${n} ${n.toLocaleString('en-US')} `;
  }

  for (const match of ev.matchAll(/(\d+(?:\.\d+)?)\s*([mMbBkK])\b/g)) {
    const mult = match[2].toLowerCase() === 'k' ? 1000 : match[2].toLowerCase() === 'm' ? 1000000 : 1000000000;
    const n = parseFloat(match[1]) * mult;
    expanded += ` ${n} ${n.toLocaleString('en-US')} `;
    if (n >= 100000000) expanded += ` ${n / 100000000}亿 `;
    if (n >= 10000) expanded += ` ${n / 10000}万 `;
  }

  return expanded;
}

// Fail closed on observable violations; this is not a substitute for source review.
export function validateEditorial(value, {title=false, evidence=''}={}) {
  const evNorm = normalizeEvidence(evidence);
  for (const lang of ['ja','en','zh']) {
    const s=value?.[lang];
    if(typeof s!=='string'||!s.trim())throw new Error('Missing native editorial field');
    // Numerical facts: if present in narrative, they MUST be grounded in the provided evidence.
    if(!title&&/[0-9０-９]/u.test(s)) {
      if(!evidence) throw new Error('Numerical editorial claim requires structured evidence');
      const sNorm = s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/(?<=\d),(?=\d)/g, '');
      const nums = sNorm.match(/\d+(?:\.\d+)?/g) || [];
      for(const num of nums) {
        if(!evNorm.includes(num)) {
          throw new Error(`Unverified numerical claim: ${num}`);
        }
      }
    }
    if(lang==='ja'&&/[\uac00-\ud7af]|本周|事业|半导体|主办|关注|开设|详细|现状|申请|进行|针对/u.test(s))throw new Error('Japanese language contamination');
    if(lang==='en'&&/[\u3040-\u30ff\uac00-\ud7af]/u.test(s))throw new Error('English language contamination');
  }
  return value;
}

