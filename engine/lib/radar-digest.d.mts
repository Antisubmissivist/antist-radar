export const BOARDS: readonly string[];
export const DECAY_HALF_LIFE_HOURS: number;
export function buildMarkdown(s: unknown, lang?: string, boards?: string[]): string;
export function buildPlain(s: unknown, lang?: string, boards?: string[]): string;
export function selectBoard(events: unknown, board: string, n?: number, now?: number): any[];
export function rankScore(score: unknown, dateStr: unknown, now?: number): number;
export function currentScore(score: unknown, dateStr: unknown, now?: number): number;
