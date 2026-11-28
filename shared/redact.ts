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
 *
 * So a place name only counts with a house/lane/unit number next to it
 * (`号`, `弄`, `栋`, `幢`, `单元`, `室`, `楼`), and the parts may be
 * separated by spaces — people paste "上海市 浦东新区 世纪大道 100 号".
 * A bare `道` is not accepted as a street marker: "我知道3号楼" is a
 * sentence, not an address.
 *
 * The pieces are regex literals rather than strings so the language
 * guard (`server/i18n.test.ts`) sees patterns to match user text, not
 * untranslated interface copy.
 */
/** The house/lane/unit number an address needs to count. */
const ADDRESS_UNIT = /\d+\s*(?:号|弄|栋|幢|单元|室|楼)/u.source;
/**
 * What may follow the first number and still be the same address.
 *
 * A house number is not the whole address: "淮海中路1234号501室" keeps
 * the room, "淮海中路1234弄5号" keeps the second number, and
 * "建国路88号SOHO现代城" keeps the building's name. The share copy used
 * to replace only up to the first number and print the rest (C6.3). A
 * floor/room number may have spaces around it ("100 号 501 室"); a named
 * building has to be written against the number, so an ordinary phrase
 * after an address ("1234号楼下等我") is not swallowed.
 */
const ADDRESS_TAIL = /(?:\s*\d+\s*(?:号|弄|栋|幢|单元|室|楼|层)|[A-Za-z][A-Za-z0-9]*[\u4e00-\u9fa5]{0,8}?(?:城|大厦|广场|花园|公寓|苑|中心|府)|[\u4e00-\u9fa5]{2,10}?(?:城|大厦|广场|花园|公寓|苑|中心|府))*/u.source;
const ADDRESS_PROVINCE = /[\u4e00-\u9fa5]{2,10}?(?:省|自治区)/u.source;
const ADDRESS_CITY = /[\u4e00-\u9fa5]{2,10}?市/u.source;
const ADDRESS_DISTRICT = /[\u4e00-\u9fa5]{2,10}?(?:区|县)/u.source;
/** A street: 路, 街, 巷, 大道, 弄, 胡同 or 大街. */
const ADDRESS_STREET = /[\u4e00-\u9fa5A-Za-z0-9]{2,20}?(?:路|街|巷|大道|弄|胡同|大街)/u.source;
/** A named compound: the address is the compound plus a building number. */
const ADDRESS_PLACE = /[\u4e00-\u9fa5A-Za-z0-9]{2,20}?(?:小区|花园|公寓|大厦|广场|家园|苑)/u.source;

const CITY_ADDRESS_RE = new RegExp(
  `(?:${ADDRESS_PROVINCE}\\s*)?${ADDRESS_CITY}\\s*(?:${ADDRESS_DISTRICT}\\s*)?(?:${ADDRESS_STREET}|${ADDRESS_PLACE})\\s*${ADDRESS_UNIT}${ADDRESS_TAIL}`,
  "gu",
);
/** An address without the city: a street (or compound) and a number. */
const STREET_ADDRESS_RE = new RegExp(
  `(?:${ADDRESS_DISTRICT}\\s*)?(?:${ADDRESS_STREET}|${ADDRESS_PLACE})\\s*${ADDRESS_UNIT}${ADDRESS_TAIL}`,
  "gu",
);
/**
 * An English address: a house number, at least one capitalised street
 * word, and a street suffix. An optional apartment/unit suffix goes
 * with it. The capitalised word requirement is what keeps "Room 123 is
 * ready", "the 2024 season" and "2 Way Tickets" out.
 */
const ENGLISH_ADDRESS_RE = /\b\d{1,6}[A-Za-z]{0,2}\s+(?:[A-Z][A-Za-z.'-]*\s+){1,4}(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Drive|Dr\.?|Boulevard|Blvd\.?|Court|Ct\.?|Place|Pl\.?|Way|Terrace|Circle|Highway)\b(?:\s*,?\s*(?:Apt\.?|Apartment|Unit|Suite|Ste\.?|#)\s*[A-Za-z0-9-]+)?/g;

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
    .replace(STREET_ADDRESS_RE, replace)
    .replace(ENGLISH_ADDRESS_RE, replace);
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
 * The metadata a record may carry that is not an enum.
 *
 * `register`, `mode` and `direction` are small closed values the writer
 * and the measurements read; every other string in `meta` is text that
 * came out of the person's file. The importers keep some of the
 * original text outside `content` — the transcript of a voice note
 * (`meta.transcript`), the file name of unpacked media (`meta.path`),
 * a sticker label, a location name — and a redacted import has to
 * replace it too (C1.7): the promise is that the original cannot be
 * found again, and `recordText`/the search tokens read `meta.transcript`
 * as the row's text.
 */
const META_STRUCTURAL_KEYS = new Set(["register", "mode", "direction"]);

function redactMetaValue(
  value: unknown,
  options: RedactionOptions,
  counts: RedactionCounts,
  people: Array<{ pattern: string; token: string }>,
): unknown {
  if (typeof value === "string") return redactText(value, options, counts, people);
  if (Array.isArray(value)) {
    return value.map((item) => redactMetaValue(item, options, counts, people));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = redactMetaValue(item, options, counts, people);
    }
    return next;
  }
  return value;
}

/**
 * Redacts the text fields of a record's `meta`, not only `content`.
 *
 * Returns the input object untouched when nothing changed, so callers
 * can compare identities. `null` and non-object values are passed
 * through.
 */
function redactMeta(
  meta: Record<string, unknown> | null | undefined,
  options: RedactionOptions,
  counts: RedactionCounts,
  people: Array<{ pattern: string; token: string }>,
) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (META_STRUCTURAL_KEYS.has(key)) {
      next[key] = value;
      continue;
    }
    const replaced = redactMetaValue(value, options, counts, people);
    if (replaced !== value) changed = true;
    next[key] = replaced;
  }
  return changed ? next : meta;
}

/**
 * Returns a new list of records with the chosen patterns replaced.
 *
 * Does not mutate the input. `role: "other"` speakers that match a
 * hidden name are replaced with the same token used in the content.
 * The text fields of `meta` are replaced with the same matcher, and the
 * replacements count into the same report as the content (C1.7).
 */
export function redactRecords<
  T extends {
    content: string;
    speaker: string;
    role?: string;
    meta?: Record<string, unknown> | null;
  },
>(records: T[], options: RedactionOptions): { records: T[]; counts: RedactionCounts } {
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
    const meta = redactMeta(row.meta, options, counts, people);
    if (content === row.content && speaker === row.speaker && meta === row.meta) return row;
    return { ...row, content, speaker, meta } as T;
  });
  return { records: next, counts };
}
