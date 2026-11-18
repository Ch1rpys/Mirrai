/**
 * How they called each other, counted from the records.
 *
 * A nickname field is one word, written once. People change what they
 * call someone — distant uses the full name, warm uses the diminutive —
 * and that change is in the lines, not in the form.
 */
import { isTextRecord } from "./records";
import {
  FINGERPRINT_STATES,
  type EmotionalState,
  type FingerprintRow,
} from "./style-fingerprint";

export type AddressDirection = "them_to_me" | "me_to_them";

export interface AddressEntry {
  form: string;
  direction: AddressDirection;
  total: number;
  byQuarter: Record<string, number>;
  byState: Partial<Record<EmotionalState, number>>;
  firstAt?: string;
  lastAt?: string;
}

const VOCATIVE_MIN = 8;
const VOCATIVE_SHARE = 0.4;

const START_AFTER = new Set(["，", ",", "！", "!", "～", "~", "。", "？", "?", "…", "⋯"]);

export function mineAddressForms(rows: FingerprintRow[], known: string[] = []): AddressEntry[] {
  const knownSet = new Set(known.map((form) => form.trim()).filter(Boolean));
  const them = collectDirection(
    rows.filter((row) => row.role === "assistant" && isTextRecord(row)),
    "them_to_me",
    knownSet,
  );
  const me = collectDirection(
    rows.filter((row) => row.role === "user" && isTextRecord(row)),
    "me_to_them",
    knownSet,
  );
  return [...them, ...me];
}

export function normalizeAddressHistory(value: unknown): AddressEntry[] {
  if (!Array.isArray(value)) return [];
  const out: AddressEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const form = typeof (row as { form?: unknown }).form === "string"
      ? (row as { form: string }).form.trim()
      : "";
    const direction = (row as { direction?: unknown }).direction;
    if (!form || (direction !== "them_to_me" && direction !== "me_to_them")) continue;
    const total = typeof (row as { total?: unknown }).total === "number" ? (row as { total: number }).total : 0;
    const byQuarter = quarterMap((row as { byQuarter?: unknown }).byQuarter);
    const byState = stateMap((row as { byState?: unknown }).byState);
    const firstAt = isoOf((row as { firstAt?: unknown }).firstAt);
    const lastAt = isoOf((row as { lastAt?: unknown }).lastAt);
    out.push({ form, direction, total, byQuarter, byState, ...(firstAt ? { firstAt } : {}), ...(lastAt ? { lastAt } : {}) });
  }
  return out;
}

export function pickThemToMeAddress(
  history: AddressEntry[],
  options: { period?: { from?: string; to?: string } | null } = {},
): string | null {
  const them = history.filter((entry) => entry.direction === "them_to_me");
  if (them.length === 0) return null;
  const period = options.period;
  const from = period?.from ? Date.parse(period.from) : Number.NaN;
  const to = period?.to ? Date.parse(period.to) : Number.NaN;
  if (Number.isFinite(from) && Number.isFinite(to)) {
    return bestForm(them, (entry) => sumOverlapping(entry.byQuarter, from, to));
  }
  const latest = latestQuarter(them);
  if (!latest) return bestForm(them, (entry) => entry.total);
  return bestForm(them, (entry) => entry.byQuarter[latest] ?? 0);
}

function collectDirection(
  rows: FingerprintRow[],
  direction: AddressDirection,
  known: Set<string>,
): AddressEntry[] {
  const vocative = new Map<string, Stats>();
  const total = new Map<string, number>();
  const candidates = new Set<string>(known);

  for (const row of rows) {
    const text = String(row.content ?? "").trim();
    if (!text) continue;
    for (const form of vocativesIn(text, known)) {
      candidates.add(form);
      bumpVocative(vocative, form, row);
    }
  }
  for (const row of rows) {
    const text = String(row.content ?? "").trim();
    if (!text) continue;
    for (const form of candidates) {
      const n = countOccurrences(text, form);
      if (n > 0) total.set(form, (total.get(form) ?? 0) + n);
    }
  }

  const out: AddressEntry[] = [];
  for (const form of candidates) {
    const stats = vocative.get(form);
    const all = total.get(form) ?? 0;
    if (!stats || all < 1) continue;
    if (stats.count < VOCATIVE_MIN) continue;
    if (stats.count / all < VOCATIVE_SHARE) continue;
    out.push({
      form,
      direction,
      total: stats.count,
      byQuarter: stats.byQuarter,
      byState: stats.byState,
      ...(stats.firstAt ? { firstAt: stats.firstAt } : {}),
      ...(stats.lastAt ? { lastAt: stats.lastAt } : {}),
    });
  }
  return out.sort((a, b) => b.total - a.total || a.form.localeCompare(b.form));
}

interface Stats {
  count: number;
  byQuarter: Record<string, number>;
  byState: Partial<Record<EmotionalState, number>>;
  firstAt?: string;
  lastAt?: string;
}

function bumpVocative(map: Map<string, Stats>, form: string, row: FingerprintRow): void {
  const current = map.get(form) ?? { count: 0, byQuarter: {}, byState: {} };
  current.count += 1;
  const at = asDate(row.timestamp);
  if (at) {
    const key = quarterKey(at);
    current.byQuarter[key] = (current.byQuarter[key] ?? 0) + 1;
    const iso = at.toISOString();
    if (!current.firstAt || iso < current.firstAt) current.firstAt = iso;
    if (!current.lastAt || iso > current.lastAt) current.lastAt = iso;
  }
  if (typeof row.emotion === "string" && (FINGERPRINT_STATES as readonly string[]).includes(row.emotion)) {
    const state = row.emotion as EmotionalState;
    current.byState[state] = (current.byState[state] ?? 0) + 1;
  }
  map.set(form, current);
}

function vocativesIn(text: string, known: Set<string>): string[] {
  const chars = Array.from(text.trim());
  const found = new Set<string>();
  if (chars.length >= 1 && chars.length <= 4) {
    const token = chars.join("");
    if (isVocativeToken(token)) found.add(token);
  }
  for (let n = 1; n <= 4 && n < chars.length; n++) {
    const token = chars.slice(0, n).join("");
    const next = chars[n]!;
    if (isVocativeToken(token) && (START_AFTER.has(next) || /\s/.test(next))) found.add(token);
  }
  for (let n = 1; n <= 4 && n < chars.length; n++) {
    const token = chars.slice(chars.length - n).join("");
    const before = chars[chars.length - n - 1]!;
    if (isVocativeToken(token) && (before === "," || before === "，" || /\s/.test(before))) found.add(token);
  }
  for (const form of known) {
    if (form && text.startsWith(form)) found.add(form);
  }
  return [...found];
}

function isVocativeToken(token: string): boolean {
  const chars = Array.from(token);
  if (chars.length < 1 || chars.length > 4) return false;
  return chars.every((char) => /[\u4e00-\u9fffA-Za-z]/.test(char));
}

function countOccurrences(text: string, form: string): number {
  if (!form) return 0;
  let n = 0;
  let from = 0;
  while (from <= text.length - form.length) {
    const at = text.indexOf(form, from);
    if (at < 0) break;
    n += 1;
    from = at + form.length;
  }
  return n;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function quarterKey(at: Date): string {
  const quarter = Math.floor(at.getUTCMonth() / 3) + 1;
  return `${at.getUTCFullYear()}Q${quarter}`;
}

function latestQuarter(entries: AddressEntry[]): string | null {
  let latest: string | null = null;
  for (const entry of entries) {
    for (const [key, count] of Object.entries(entry.byQuarter)) {
      if (count < 1) continue;
      if (!latest || key > latest) latest = key;
    }
  }
  return latest;
}

function quarterBounds(key: string): { from: number; to: number } | null {
  const match = /^(\d{4})Q([1-4])$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const month = (quarter - 1) * 3;
  return { from: Date.UTC(year, month, 1), to: Date.UTC(year, month + 3, 1) };
}

function sumOverlapping(byQuarter: Record<string, number>, from: number, to: number): number {
  let n = 0;
  for (const [key, count] of Object.entries(byQuarter)) {
    const bounds = quarterBounds(key);
    if (!bounds) continue;
    if (bounds.from < to && bounds.to > from) n += count;
  }
  return n;
}

function bestForm(entries: AddressEntry[], score: (entry: AddressEntry) => number): string | null {
  const ranked = entries
    .map((entry) => ({ form: entry.form, n: score(entry) }))
    .filter((row) => row.n > 0)
    .sort((a, b) => b.n - a.n || a.form.localeCompare(b.form));
  return ranked[0]?.form ?? null;
}

function quarterMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) out[key] = count;
  }
  return out;
}

function stateMap(value: unknown): Partial<Record<EmotionalState, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<Record<EmotionalState, number>> = {};
  for (const state of FINGERPRINT_STATES) {
    const count = (value as Record<string, unknown>)[state];
    if (typeof count === "number" && Number.isFinite(count) && count > 0) out[state] = count;
  }
  return out;
}

function isoOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
