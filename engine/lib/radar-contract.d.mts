export type Localized=Record<'ja'|'en'|'zh',string>;
export interface RadarEvent {id:string;source:string;url:string;category:'ai'|'tech'|'japan-residence'|'japan-life'|'geopolitics'|'crypto'|'stocks';publishedAt:string|null;fetchedAt:string;stage:'announcement'|'draft'|'open'|'closed'|'withdrawn'|'unknown';deadlineAt:string|null;title:Localized;summary:Localized;audience:Localized;action:Localized;unknowns:Localized;evidence:string;change:'new'|'updated'|'unchanged'}
export interface Quote {symbol:string;name:string;price:number;changePct:number;at:string;source:string}
export interface Source {name:string;status:'ok'|'quiet'|'degraded'|'unavailable'|'stale';count:number;url:string;fetchedAt:string}
export interface Forecast {id:string;createdAt:string;dueAt:string;symbol:string;baseline:number;direction:'above'|'below';probability:number;claim:Localized;rationale:Localized;evidence:string[]}
export interface Snapshot {schema:2;id:string;generatedAt:string;sweepMs:number;analysisStatus:'complete'|'degraded';digest:Localized;events:RadarEvent[];markets:Quote[];sources:Source[];forecasts:Forecast[]}
export function publicSnapshot(input:unknown,privateValues?:string[]):Snapshot;
export function resolveForecast(forecast:{symbol:unknown;baseline:unknown;direction:unknown;dueAt:unknown},quotes:Quote[],now?:number):{status:'hit'|'miss';observed:number;observationAt:string;resolvedAt:string}|null;
export function assertPrivateFree(value:unknown,privateValues?:string[]):unknown;
export function url(value:unknown):string;
export function multilingual(value:unknown,max?:number):Localized;
