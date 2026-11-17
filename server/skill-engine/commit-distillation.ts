/**
 * The distillation's write of the persona.
 *
 * One version is the persona as it was, taken before the write. One
 * version is the persona as the write left it. A later edit can put
 * either back. A missing snapshot does not stop the write: the persona
 * is still saved, and the log says the version was not stored.
 */
import * as db from "../db";

function dbFn(name: string): ((...args: never[]) => unknown) | undefined {
  try {
    const value = (db as Record<string, unknown>)[name];
    return typeof value === "function" ? (value as (...args: never[]) => unknown) : undefined;
  } catch {
    return undefined;
  }
}

async function snapshot(personaId: number, userId: number): Promise<void> {
  const store = dbFn("createPersonaVersion") as
    | ((personaId: number, userId: number, reason: string) => Promise<unknown>)
    | undefined;
  try {
    await store?.(personaId, userId, "distill");
  } catch (error) {
    console.warn("[SkillEngine] The persona version was not stored:", error);
  }
}

export async function commitDistilledPersona(
  personaId: number,
  userId: number,
  patch: Parameters<typeof db.updatePersona>[2],
): Promise<void> {
  await snapshot(personaId, userId);
  await db.updatePersona(personaId, userId, patch);
  await snapshot(personaId, userId);
}
