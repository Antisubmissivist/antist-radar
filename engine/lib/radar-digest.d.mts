export const BOARDS: readonly string[];
export function buildMarkdown(s: unknown, lang?: string, boards?: string[]): string;
export function buildPlain(s: unknown, lang?: string, boards?: string[]): string;
export function selectBoard(events: unknown, board: string, n?: number, now?: number): any[];
export function rankScore(score: unknown, dateStr: unknown, now?: number): number;
