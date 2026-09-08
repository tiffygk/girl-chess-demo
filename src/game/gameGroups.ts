// Grouping and naming for the past-games drawer (resume round, Wave D). Pure,
// so it tests without a DOM. Dates come from SQLite as UTC
// "YYYY-MM-DD HH:MM:SS" -- parseUtc is the same UTC-safe parse
// src/review/localDate.ts's localDateFromStartedAt already worked out;
// imported from there rather than redone here.
import { parseUtc } from "../review/localDate";
import type { GameListEntry } from "./api";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(startedAt: string, now: Date): string {
  const d = parseUtc(startedAt);
  const today = localDayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const key = localDayKey(d);
  if (key === today) return "today";
  if (key === localDayKey(yesterday)) return "yesterday";
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

export function groupGamesByDay(
  games: GameListEntry[],
  now: Date
): { label: string; games: GameListEntry[] }[] {
  const out: { label: string; games: GameListEntry[] }[] = [];
  for (const g of games) {
    const label = dayLabel(g.startedAt, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.games.push(g);
    else out.push({ label, games: [g] });
  }
  return out;
}

export function resultOrStatusWord(
  g: GameListEntry
): "won" | "lost" | "draw" | "in progress" | "unfinished" {
  if (g.result === "1-0") return "won";
  if (g.result === "0-1") return "lost";
  if (g.result != null) return "draw";
  return g.resumable ? "in progress" : "unfinished";
}
