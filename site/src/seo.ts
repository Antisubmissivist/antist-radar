export const ORIGIN='https://radar.antist.ai';
export const languages=['ja','en','zh'] as const;
export type Locale=typeof languages[number];
export const titles={ja:'Antist Radar — 変化を、判断に。',en:'Antist Radar — From signals to decisions.',zh:'Antist Radar — 看见变化，形成判断。'};
export const descriptions={ja:'日本と世界の一次情報、暮らしの選択肢、検証できる予測。根拠と更新時刻を公開する独立レーダー。',en:'An independent radar for Japan and the world. Primary sources, practical decisions and accountable forecasts, with evidence and timestamps.',zh:'面向日本与世界的独立信息雷达。一手信源、生活选择与可验证判断，每条信息附依据和时间。'};
