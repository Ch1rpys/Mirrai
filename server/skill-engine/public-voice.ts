/**
 * How they talk to everyone (B7.12).
 *
 * The public register — moments, posts — is a different voice from the
 * one-to-one conversation. It is described once, from the public rows
 * only, and it is shown on the profile. It is never put into a
 * one-to-one prompt.
 *
 * Twenty public posts is the minimum. The description is capped at
 * three hundred characters and has to cite the words it is based on.
 */
import { copy, type Locale } from "@shared/copy";
import type { LLMMessage } from "../llm/types";
import { asMaterial } from "./material";
import * as db from "../db";

export const PUBLIC_VOICE_MIN_POSTS = 20;
export const PUBLIC_VOICE_MAX_CHARS = 300;

function dbFn(name: string): ((...args: never[]) => unknown) | undefined {
  try {
    const value = (db as Record<string, unknown>)[name];
    return typeof value === "function" ? (value as (...args: never[]) => unknown) : undefined;
  } catch {
    return undefined;
  }
}

export async function readPublicPosts(
  personaId: number,
  userId: number,
): Promise<string[]> {
  const iterate = dbFn("iterateRecords") as
    | ((
        personaId: number,
        userId: number,
        options: { register: string },
      ) => AsyncIterable<{ role?: string | null; kind?: string | null; content?: string | null }>)
    | undefined;
  if (!iterate) return [];
  const posts: string[] = [];
  for await (const row of iterate(personaId, userId, { register: "public" })) {
    if (row.role !== "assistant") continue;
    if ((row.kind ?? "text") !== "text") continue;
    const text = String(row.content ?? "").trim();
    if (text) posts.push(text);
    if (posts.length >= 80) break;
  }
  return posts;
}

export async function distillPublicVoice(params: {
  personaId: number;
  userId: number;
  name: string;
  locale: Locale;
  invoke: (messages: LLMMessage[]) => Promise<string>;
}): Promise<string | null> {
  const posts = await readPublicPosts(params.personaId, params.userId);
  if (posts.length < PUBLIC_VOICE_MIN_POSTS) return null;
  const material = posts.slice(0, 40).map((line) => asMaterial(line, params.locale)).join("\n");
  const instruction = copy(params.locale, "prompt.publicVoiceInstruction", {
    name: params.name,
  });
  let answer = "";
  try {
    answer = await params.invoke([
      { role: "system", content: instruction },
      { role: "user", content: material },
    ]);
  } catch {
    return null;
  }
  const text = String(answer ?? "").trim();
  if (!text) return null;
  return text.slice(0, PUBLIC_VOICE_MAX_CHARS);
}
