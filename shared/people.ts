/**
 * The people who keep turning up in the records.
 *
 * Distillation already writes a card for each name it notices. This
 * module folds those cards into one row per person, counts how often
 * the name appears, and keeps the row out of the prompt until the
 * user says it is real — and even then, only on the turn that
 * mentions them.
 */
import { copy, type Locale } from "./copy";
import { recordText, type RecordContentRow } from "./records";
import { containsTerm } from "./term-match";

export const PEOPLE_MIN_MENTIONS = 3;
export const PEOPLE_PROMPT_CAP = 4;
export const PERSON_NAME_MAX = 40;
export const PERSON_RELATION_MAX = 20;
export const PERSON_SIDES = ["them", "me", "both"] as const;

export type PersonSide = (typeof PERSON_SIDES)[number];

export interface PersonEvidence {
  at?: string;
  snippet: string;
}

export interface Person {
  id: string;
  name: string;
  aliases: string[];
  relation: string;
  side: PersonSide;
  mentions: number;
  lastMentionedAt?: string;
  evidence: PersonEvidence[];
  source: "auto" | "manual";
  verified: boolean;
}

export interface PersonCard {
  claim?: string | null;
  payload?: unknown;
}

export type PersonRecordLine = RecordContentRow & {
  timestamp?: Date | string | null;
};

// i18n:allow-input — kinship/nickname prefixes in the records, not copy.
const PREFIXES = ["我", "阿", "小"] as const;

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function toSide(value: unknown): PersonSide {
  return PERSON_SIDES.includes(value as PersonSide) ? (value as PersonSide) : "them";
}

function toEvidence(value: unknown): PersonEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: PersonEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const snippet = toText(record.snippet);
    if (!snippet) continue;
    const at = toText(record.at);
    out.push(at ? { at, snippet } : { snippet });
  }
  return out;
}

function stampOf(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const text = String(value).trim();
  return text || undefined;
}

function idFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return `auto-person-${Math.abs(hash).toString(36)}`;
}

export function peopleRejectedKey(name: string): string {
  return `people:${name}`;
}

/**
 * Strip the kinship / nickname prefixes the records use.
 *
 * "阿强" and "强" are the same person; "我妈" is not "妈妈" — the
 * second word is a relation, not a shorter form of the first.
 */
export function stripPersonPrefix(name: string): string {
  let next = name.trim();
  while (next.length > 1 && PREFIXES.some((prefix) => next.startsWith(prefix))) {
    next = next.slice(1);
  }
  return next;
}

export function namesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return stripPersonPrefix(a) === b || stripPersonPrefix(b) === a;
}

export function normalizePeople(value: unknown): Person[] {
  if (!Array.isArray(value)) return [];
  const out: Person[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const name = toText(record.name).slice(0, PERSON_NAME_MAX);
    if (!name || seen.has(name)) return;
    seen.add(name);
    const aliases = Array.isArray(record.aliases)
      ? [...new Set(record.aliases.map((alias) => toText(alias).slice(0, PERSON_NAME_MAX)).filter((alias) => alias && alias !== name))]
      : [];
    const source = record.source === "manual" ? "manual" : "auto";
    const person: Person = {
      id: toText(record.id) || `person-${index + 1}`,
      name,
      aliases,
      relation: toText(record.relation).slice(0, PERSON_RELATION_MAX),
      side: toSide(record.side),
      mentions: toCount(record.mentions),
      evidence: toEvidence(record.evidence),
      source,
      verified: record.verified === true,
    };
    const lastMentionedAt = toText(record.lastMentionedAt);
    if (lastMentionedAt) person.lastMentionedAt = lastMentionedAt;
    out.push(person);
  });
  return out;
}

function payloadField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object") return "";
  return toText((payload as Record<string, unknown>)[key]);
}

function modeOf(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = "";
  let n = -1;
  for (const [value, count] of counts) {
    if (count > n || (count === n && value < best)) {
      best = value;
      n = count;
    }
  }
  return best;
}

function clusterNames(names: string[]): string[][] {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const parent = unique.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]!);
    return parent[index]!;
  };
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      if (namesMatch(unique[i]!, unique[j]!)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  unique.forEach((name, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(name);
    groups.set(root, list);
  });
  return [...groups.values()];
}

function mentionsName(text: string, name: string): boolean {
  return containsTerm(text, name);
}

function hitsFor(names: string[], rows: PersonRecordLine[]): PersonRecordLine[] {
  return rows.filter((row) => {
    const text = recordText(row);
    return names.some((name) => mentionsName(text, name));
  });
}

function evidenceFrom(hits: PersonRecordLine[], relation: string): PersonEvidence[] {
  const dated = hits
    .map((row) => ({
      at: stampOf(row.timestamp),
      snippet: recordText(row),
      time: row.timestamp ? new Date(row.timestamp).getTime() : Number.POSITIVE_INFINITY,
    }))
    .filter((row) => row.snippet);
  dated.sort((a, b) => a.time - b.time);
  if (!dated.length) return [];
  const earliest = dated[0]!;
  const rest = dated.slice(1);
  const withRelation = relation
    ? rest.filter((row) => row.snippet.includes(relation))
    : [];
  const picked = [earliest];
  const seen = new Set([earliest.snippet]);
  for (const row of [...withRelation, ...rest]) {
    if (picked.length >= 3) break;
    if (seen.has(row.snippet)) continue;
    seen.add(row.snippet);
    picked.push(row);
  }
  return picked.map((row) => (row.at ? { at: row.at, snippet: row.snippet } : { snippet: row.snippet }));
}

/**
 * Fold person-cards into one row per person, counted on the records.
 *
 * A name that appears twice is noise. Three times is a person they
 * actually talk about.
 */
export function aggregatePeople(cards: PersonCard[], rows: PersonRecordLine[]): Person[] {
  const named = cards
    .map((card) => toText(card.claim).slice(0, PERSON_NAME_MAX))
    .filter(Boolean);
  if (!named.length) return [];
  const clusters = clusterNames(named);
  const people: Person[] = [];
  for (const cluster of clusters) {
    const clusterCards = cards.filter((card) => cluster.includes(toText(card.claim)));
    const hits = hitsFor(cluster, rows);
    if (hits.length < PEOPLE_MIN_MENTIONS) continue;
    const mentionCounts = cluster.map((name) => ({
      name,
      n: hits.filter((row) => mentionsName(recordText(row), name)).length,
      // A prefixed form is the name they actually use ("阿强", not "强").
      fuller: cluster.some((other) => other !== name && stripPersonPrefix(name) === other) ? 1 : 0,
    }));
    mentionCounts.sort((a, b) => b.fuller - a.fuller || b.n - a.n || b.name.length - a.name.length || a.name.localeCompare(b.name));
    const display = mentionCounts[0]?.name ?? cluster[0]!;
    const aliases = cluster.filter((name) => name !== display);
    const relation = modeOf(
      clusterCards.map((card) => payloadField(card.payload, "relation")),
    ).slice(0, PERSON_RELATION_MAX);
    const side = toSide(modeOf(clusterCards.map((card) => payloadField(card.payload, "side"))));
    const last = hits
      .map((row) => stampOf(row.timestamp))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    const person: Person = {
      id: idFor(display),
      name: display,
      aliases,
      relation,
      side,
      mentions: hits.length,
      evidence: evidenceFrom(hits, relation),
      source: "auto",
      verified: false,
    };
    if (last) person.lastMentionedAt = last;
    people.push(person);
  }
  people.sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
  return people;
}

function coversPerson(kept: Person, candidate: Person): boolean {
  const keptNames = [kept.name, ...kept.aliases];
  const candidateNames = [candidate.name, ...candidate.aliases];
  return candidateNames.some((name) => keptNames.some((keptName) => namesMatch(name, keptName)));
}

/**
 * Confirmed people survive a re-run. Rejected names stay gone.
 */
export function mergePeople(
  previous: unknown,
  mined: unknown,
  rejectedKeys: string[] = [],
): Person[] {
  const confirmed = normalizePeople(previous).filter((row) => row.verified);
  const rejected = new Set(rejectedKeys);
  const fresh = normalizePeople(mined).filter((row) => {
    if (confirmed.some((kept) => coversPerson(kept, row))) return false;
    if (rejected.has(peopleRejectedKey(row.name))) return false;
    if (row.aliases.some((alias) => rejected.has(peopleRejectedKey(alias)))) return false;
    return true;
  });
  return [...confirmed, ...fresh];
}

export function mentionedPeople(
  people: Person[],
  texts: string[],
  cap = PEOPLE_PROMPT_CAP,
): Person[] {
  const hits = people.filter((person) => {
    if (!person.verified) return false;
    const names = [person.name, ...person.aliases];
    return texts.some((text) => names.some((name) => mentionsName(text, name)));
  });
  return hits.slice(0, cap);
}

export function renderPeopleSection(people: Person[], locale: Locale = "zh"): string {
  if (!people.length) return "";
  const lines = people.map((person) =>
    person.relation
      ? copy(locale, "prompt.peopleLine", { name: person.name, relation: person.relation })
      : person.name,
  );
  return [copy(locale, "prompt.peopleHeading"), ...lines].join("\n");
}

/**
 * Fold one person into another: the absorbed name becomes an alias.
 */
export function mergePersonEntries(people: Person[], fromId: string, intoId: string): Person[] {
  if (fromId === intoId) return people;
  const from = people.find((row) => row.id === fromId);
  const into = people.find((row) => row.id === intoId);
  if (!from || !into) return people;
  const aliases = [...new Set(
    [into.name, ...into.aliases, from.name, ...from.aliases].filter((name) => name && name !== into.name),
  )];
  const lastMentionedAt = [into.lastMentionedAt, from.lastMentionedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const merged: Person = {
    ...into,
    aliases,
    relation: into.relation || from.relation,
    mentions: into.mentions + from.mentions,
    evidence: [...into.evidence, ...from.evidence].slice(0, 3),
    verified: into.verified || from.verified,
  };
  if (lastMentionedAt) merged.lastMentionedAt = lastMentionedAt;
  return people.filter((row) => row.id !== fromId).map((row) => (row.id === intoId ? merged : row));
}
