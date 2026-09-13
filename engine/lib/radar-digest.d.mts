export const BOARDS: readonly string[];
export function buildMarkdown(s: unknown, lang?: string, boards?: string[]): string;
export function buildPlain(s: unknown, lang?: string, boards?: string[]): string;
export function rankScore(score: unknown, dateStr?: string | null, now?: number): number;
export function selectBoard(events: unknown, board: string, n?: number, now?: number): any[];
