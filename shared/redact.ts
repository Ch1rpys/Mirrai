/**
 * Replaces third-party names and numbers in imported records.
 *
 * The tokens are English on purpose: they are stored as-is and rendered
 * as-is, in both languages, so a later search for the original cannot
 * find it.
 */

export interface RedactionOptions {
  phones?: boolean;
  ids?: boolean;
  emails?: boolean;
  cards?: boolean;
  /**
   * Street addresses (C6.3).
   *
   * Only the keepsake book's share copy asks for this: the import
   * wizard's four switches are phones, ids, emails and cards, and the
   * records themselves keep the addresses the user chose to import.
   */
  addresses?: boolean;
  names?: string[];
  /** Persona and user names, which must stay so the persona still knows itself. */
  keepNames?: string[];
}

export interface RedactionCounts {
  phones: number;
  ids: number;
  emails: number;
  cards: number;
  names: number;
  addresses: number;
}

export interface RedactionReport {
  phones: boolean;
  ids: boolean;
  emails: boolean;
  cards: boolean;
  addresses: boolean;
  nameCount: number;
  replaced: RedactionCounts;
}

export function emptyRedactionCounts(): RedactionCounts {
  return { phones: 0, ids: 0, emails: 0, cards: 0, names: 0, addresses: 0 };
}

export function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function isKeptName(value: string, keepNames: string[]): boolean {
  const key = normalizeName(value);
  if (!key) return false;
  return keepNames.some((name) => normalizeName(name) === key);
}

export function isRedactionActive(options?: RedactionOptions | null): boolean {
  if (!options) return false;
  return Boolean(
    options.phones
      || options.ids
      || options.emails
      || options.cards
      || (options.names && options.names.some((name) => name.trim())),
  );
}

export function redactionReportOf(
  options: RedactionOptions,
  counts: RedactionCounts,
): RedactionReport {
  const keep = options.keepNames ?? [];
  const nameCount = (options.names ?? []).filter((name) => {
    const trimmed = name.trim();
    return trimmed.length > 0 && !isKeptName(trimmed, keep);
  }).length;
  return {
    phones: Boolean(options.phones),
    ids: Boolean(options.ids),
    emails: Boolean(options.emails),
    cards: Boolean(options.cards),
    addresses: Boolean(options.addresses),
    nameCount,
    replaced: { ...counts },
  };
}

/**
 * A street address, conservatively.
 *
 * "A city and a street with a number" is an address; a sentence that
 * mentions a city is not. The keepsake book's share version promises to
 * take the addresses out (C6.3), and a rule that replaced every sentence
 * containing a city name would take out ordinary conversation too.
 */
const CITY_ADDRESS_RE = /(?:[\u4e00-\u9fa5]{2,10}(?:省|自治区))?[\u4e00-\u9fa5]{2,10}市[\u4e00-\u9fa5A-Za-z0-9]{0,40}?(?:\d+\s*(?:号|弄|栋|幢|单元|室|楼)|\d+\s*[路街巷]|小区|花园|公寓|大厦|广场)/gu;
/** An address without the city: a street and a number. */
const STREET_ADDRESS_RE = /[\u4e00-\u9fa5]{2,10}(?:路|街|巷|大道|道)\d+\s*号/gu;

function redactAddresses(
  text: string,
  counts: RedactionCounts,
): string {
  const replace = (match: string) => {
    counts.addresses += 1;
    return "[address]";
  };
  return text
    .replace(CITY_ADDRESS_RE, replace)
    .replace(STREET_ADDRESS_RE, replace);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (doubleIt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}

function personTokensOf(names: string[], keepNames: string[]): Array<{ pattern: string; token: string; key: string }> {
  const seen = new Set<string>();
  const out: Array<{ pattern: string; token: string; key: string }> = [];
  let n = 1;
  for (const raw of names) {
    const pattern = raw.trim();
    if (!pattern) continue;
    const key = normalizeName(pattern);
    if (seen.has(key) || isKeptName(pattern, keepNames)) continue;
    seen.add(key);
    out.push({ pattern, token: `[person-${n}]`, key });
    n += 1;
  }
  out.sort((a, b) => b.pattern.length - a.pattern.length);
  return out;
}

function redactText(
  text: string,
  options: RedactionOptions,
  counts: RedactionCounts,
  people: Array<{ pattern: string; token: string }>,
): string {
  let next = text;
  if (options.emails) {
    next = next.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => {
      counts.emails += 1;
      return "[email]";
    });
  }
  if (options.ids) {
    next = next.replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, () => {
      counts.ids += 1;
      return "[id]";
    });
  }
  if (options.phones) {
    next = next.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, () => {
      counts.phones += 1;
      return "[phone]";
    });
    next = next.replace(/(?<!\d)\+\d{7,15}(?!\d)/g, () => {
      counts.phones += 1;
      return "[phone]";
    });
  }
  if (options.cards) {
    next = next.replace(/(?<!\d)\d{13,19}(?!\d)/g, (digits) => {
      if (!passesLuhn(digits)) return digits;
      counts.cards += 1;
      return "[card]";
    });
  }
  if (options.addresses) {
    next = redactAddresses(next, counts);
  }
  for (const person of people) {
    const re = new RegExp(escapeRegExp(person.pattern), "gi");
    next = next.replace(re, () => {
      counts.names += 1;
      return person.token;
    });
  }
  return next;
}

/**
 * Redacts one string with the same tokens the records get.
 *
 * The stored parse report carries a speaker list and the first rows of a
 * raw table (C1.7); both are the user's own file, and both used to keep
 * the names and numbers that the records had already replaced. They are
 * run through the same matcher, with the same name ordering, so the
 * token in the report is the token in the record.
 */
export function redactTextWithOptions(text: string, options: RedactionOptions): string {
  const counts = emptyRedactionCounts();
  const people = personTokensOf(options.names ?? [], options.keepNames ?? []);
  return redactText(text, options, counts, people);
}

/**
 * Returns a new list of records with the chosen patterns replaced.
 *
 * Does not mutate the input. `role: "other"` speakers that match a
 * hidden name are replaced with the same token used in the content.
 */
export function redactRecords<T extends { content: string; speaker: string; role?: string }>(
  records: T[],
  options: RedactionOptions,
): { records: T[]; counts: RedactionCounts } {
  const counts = emptyRedactionCounts();
  const keepNames = options.keepNames ?? [];
  const people = personTokensOf(options.names ?? [], keepNames);
  const tokenByKey = new Map(people.map((row) => [normalizeName(row.pattern), row.token]));
  const active = Boolean(
    options.phones
      || options.ids
      || options.emails
      || options.cards
      || options.addresses
      || people.length > 0,
  );
  if (!active) return { records, counts };

  const next = records.map((row) => {
    const content = redactText(row.content, options, counts, people);
    let speaker = row.speaker;
    if (row.role !== "user" && row.role !== "assistant") {
      const token = tokenByKey.get(normalizeName(speaker));
      if (token) {
        speaker = token;
        counts.names += 1;
      }
    }
    if (content === row.content && speaker === row.speaker) return row;
    return { ...row, content, speaker };
  });
  return { records: next, counts };
}
