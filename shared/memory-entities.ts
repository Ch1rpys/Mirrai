/**
 * Named people, places, and things on a memory.
 *
 * They have to appear in the line the memory cites. A name the model
 * invented is dropped, so later retrieval cannot hop to a place that
 * was never said.
 */
import { normalizePeople, type Person } from "./people";
import { containsTerm } from "./term-match";

export interface MemoryEntities {
  people: string[];
  places: string[];
  things: string[];
}

export function emptyEntities(): MemoryEntities {
  return { people: [], places: [], things: [] };
}

function takeListed(list: unknown, quoteText: string): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    if (!quoteText.includes(text)) continue;
    if (out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

/** Keep only entities that are substrings of the cited line. */
export function sanitizeEntities(raw: unknown, quoteText: string): MemoryEntities {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyEntities();
  const record = raw as Record<string, unknown>;
  const source = String(quoteText ?? "");
  return {
    people: takeListed(record.people, source),
    places: takeListed(record.places, source),
    things: takeListed(record.things, source),
  };
}

export function parseStoredEntities(raw: unknown): MemoryEntities | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const people = Array.isArray(record.people)
    ? record.people.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const places = Array.isArray(record.places)
    ? record.places.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const things = Array.isArray(record.things)
    ? record.things.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (people.length === 0 && places.length === 0 && things.length === 0) return undefined;
  return { people, places, things };
}

export function entityValues(entities: MemoryEntities | null | undefined): string[] {
  if (!entities) return [];
  return [...entities.people, ...entities.places, ...entities.things];
}

/** Confirmed names (and aliases) that appear in the title or description. */
export function peopleEntitiesInText(text: string, people: Person[]): string[] {
  const haystack = String(text ?? "");
  const out: string[] = [];
  for (const person of people) {
    if (!person.verified) continue;
    const names = [person.name, ...person.aliases].filter(Boolean);
    /**
     * The same term matcher the distilled cards use (B6.7).
     *
     * A one-character nickname used to match any ordinary word that
     * contains it — 「小」 turned 「小米粥」 into a memory about 小满.
     */
    if (!names.some((name) => containsTerm(haystack, name))) continue;
    if (!out.includes(person.name)) out.push(person.name);
  }
  return out;
}

export function peopleEntitiesFromPersonaData(
  text: string,
  personaData: unknown,
): string[] {
  const people = normalizePeople(
    personaData && typeof personaData === "object" && !Array.isArray(personaData)
      ? (personaData as { people?: unknown }).people
      : undefined,
  );
  return peopleEntitiesInText(text, people);
}
