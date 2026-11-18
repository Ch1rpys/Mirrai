/**
 * Local embeddings for the second exemplar scorer.
 *
 * Talks only to the user's own Ollama (`ENV.ollamaUrl` + `/api/embed`).
 * A missing daemon, a missing model, or a bad response all return
 * `null`, and retrieval falls back to character bigrams. Cloud embed
 * endpoints are not used.
 *
 * API: https://docs.ollama.com/api/embed
 */
import { ENV } from "../_core/env";
import * as db from "../db";
import {
  retrieveExemplars,
  userBurstsForEmbedding,
  type CollectedReply,
  type Exemplar,
} from "./exemplars";

export const DEFAULT_EMBED_MODEL = "bge-m3";
export const EMBED_BATCH = 64;

export function embedModelName(): string {
  const named = ENV.ollamaEmbedModel.trim();
  return named || DEFAULT_EMBED_MODEL;
}

export function l2Normalize(vec: number[]): number[] {
  let sum = 0;
  for (const value of vec) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) return vec.map(() => 0);
  return vec.map((value) => value / norm);
}

/** Scale a unit vector into int8. Values are clamped to ±127. */
export function quantizeInt8(vec: number[]): Int8Array {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const scaled = Math.round(vec[i] * 127);
    out[i] = Math.max(-127, Math.min(127, scaled));
  }
  return out;
}

export function dequantizeInt8(vec: Int8Array | Buffer): number[] {
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / 127;
  return out;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export function packEmbedding(vec: number[]): Buffer {
  const packed = quantizeInt8(l2Normalize(vec));
  return Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
}

export function unpackEmbedding(buf: Buffer | Uint8Array): Int8Array {
  return Int8Array.from(buf);
}

function asNumberRows(value: unknown): number[][] | null {
  if (!Array.isArray(value)) return null;
  const rows: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length === 0) return null;
    const nums: number[] = [];
    for (const item of row) {
      if (typeof item !== "number" || !Number.isFinite(item)) return null;
      nums.push(item);
    }
    rows.push(nums);
  }
  return rows;
}

const EMBED_TIMEOUT_MS = 5_000;
const TAGS_TIMEOUT_MS = 2_000;
const CACHE_CAP = 2;

export type EmbedProbe = "ready" | "no_ollama" | "no_model";

/**
 * Embed texts with the local Ollama daemon.
 *
 * Returns `null` when Ollama is down, the model is missing, or the
 * response is not a matching list of vectors. An empty input is `[]`.
 */

function ollamaOrigin(): string {
  return ENV.ollamaUrl.replace(/\/+$/, "");
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

export async function embedTexts(
  texts: string[],
  options?: { signal?: AbortSignal; model?: string },
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const model = options?.model ?? embedModelName();
  const url = `${ollamaOrigin()}/api/embed`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
      signal: withTimeout(options?.signal, EMBED_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { embeddings?: unknown };
    const rows = asNumberRows(body.embeddings);
    if (!rows || rows.length !== texts.length) return null;
    return rows.map(l2Normalize);
  } catch {
    return null;
  }
}

function modelListed(names: string[], wanted: string): boolean {
  const needle = wanted.trim().toLowerCase();
  if (!needle) return false;
  return names.some((name) => {
    const n = name.trim().toLowerCase();
    return n === needle || n.startsWith(`${needle}:`);
  });
}

function tagsFromBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const item of models) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; model?: unknown };
    if (typeof row.name === "string" && row.name.trim()) names.push(row.name);
    else if (typeof row.model === "string" && row.model.trim()) names.push(row.model);
  }
  return names;
}

export async function probeEmbedStatus(options?: { signal?: AbortSignal }): Promise<EmbedProbe> {
  const url = `${ollamaOrigin()}/api/tags`;
  try {
    const response = await fetch(url, { signal: withTimeout(options?.signal, TAGS_TIMEOUT_MS) });
    if (!response.ok) return "no_ollama";
    const names = tagsFromBody(await response.json());
    return modelListed(names, embedModelName()) ? "ready" : "no_model";
  } catch {
    return "no_ollama";
  }
}

type EmbedCacheEntry = {
  key: string;
  dim: number;
  ids: number[];
  data: Int8Array;
  index: Map<number, number>;
};

const embedCache: EmbedCacheEntry[] = [];

export function clearEmbedCache(): void {
  embedCache.length = 0;
}

export function invalidateEmbedCache(personaId: number): void {
  const prefix = `${personaId}:`;
  for (let i = embedCache.length - 1; i >= 0; i--) {
    if (embedCache[i].key.startsWith(prefix)) embedCache.splice(i, 1);
  }
}

function cacheGet(key: string): EmbedCacheEntry | undefined {
  const i = embedCache.findIndex((entry) => entry.key === key);
  if (i < 0) return undefined;
  const [entry] = embedCache.splice(i, 1);
  embedCache.unshift(entry);
  return entry;
}

function cachePut(entry: EmbedCacheEntry): void {
  const i = embedCache.findIndex((row) => row.key === entry.key);
  if (i >= 0) embedCache.splice(i, 1);
  embedCache.unshift(entry);
  while (embedCache.length > CACHE_CAP) embedCache.pop();
}

function dbFn<T>(name: string): T | null {
  try {
    const fn = (db as Record<string, unknown>)[name];
    return typeof fn === "function" ? (fn as T) : null;
  } catch {
    return null;
  }
}

async function loadEmbedIndex(
  personaId: number,
  userId: number,
  recordsVersion: string | undefined,
): Promise<EmbedCacheEntry | null> {
  const list = dbFn<typeof db.listRecordEmbeddings>("listRecordEmbeddings");
  if (!list) return null;
  const versionFn = dbFn<typeof db.getRecordsVersion>("getRecordsVersion");
  let version = recordsVersion;
  if (!version && versionFn) {
    try {
      version = await versionFn(personaId, userId);
    } catch {
      version = "unknown";
    }
  }
  const key = `${personaId}:${version ?? "unknown"}:${embedModelName()}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  let rows: Awaited<ReturnType<typeof db.listRecordEmbeddings>>;
  try {
    rows = await list(personaId, userId, embedModelName());
  } catch {
    return null;
  }
  if (!rows.length) {
    const empty: EmbedCacheEntry = { key, dim: 0, ids: [], data: new Int8Array(0), index: new Map() };
    cachePut(empty);
    return empty;
  }
  const first = unpackEmbedding(rows[0].vec);
  const dim = first.length || rows[0].dim;
  if (!(dim > 0)) return null;
  const ids: number[] = [];
  const data = new Int8Array(rows.length * dim);
  const index = new Map<number, number>();
  let n = 0;
  for (const row of rows) {
    const packed = unpackEmbedding(row.vec);
    if (packed.length !== dim) continue;
    data.set(packed, n * dim);
    ids.push(row.recordId);
    index.set(row.recordId, n);
    n += 1;
  }
  const entry: EmbedCacheEntry = {
    key,
    dim,
    ids: ids.slice(0, n),
    data: n === rows.length ? data : data.subarray(0, n * dim),
    index,
  };
  cachePut(entry);
  return entry;
}

function cosineAt(entry: EmbedCacheEntry, recordId: number, query: number[]): number | null {
  const at = entry.index.get(recordId);
  if (at == null || entry.dim <= 0) return null;
  const packed = entry.data.subarray(at * entry.dim, (at + 1) * entry.dim);
  return cosine(query, dequantizeInt8(packed));
}

export async function retrieveExemplarsWithEmbed(
  params: Parameters<typeof retrieveExemplars>[0] & {
    personaId: number;
    userId: number;
    recordsVersion?: string;
  },
): Promise<Exemplar[]> {
  const { personaId, userId, recordsVersion, ...rest } = params;
  let index: EmbedCacheEntry | null = null;
  try {
    index = await loadEmbedIndex(personaId, userId, recordsVersion);
  } catch {
    return retrieveExemplars(rest);
  }
  if (!index || index.ids.length === 0) return retrieveExemplars(rest);

  const queryRows = await embedTexts([params.userMessage.trim()]);
  if (!queryRows || !queryRows[0]) return retrieveExemplars(rest);
  const query = queryRows[0];
  return retrieveExemplars({
    ...rest,
    embedCosine: (_previousUser, recordId) => cosineAt(index, recordId, query),
  });
}

export async function embedPersonaTurns(params: {
  personaId: number;
  userId: number;
  signal?: AbortSignal;
}): Promise<{ embedded: number }> {
  const { personaId, userId, signal } = params;
  const iterate = dbFn<typeof db.iterateRecords>("iterateRecords");
  const upsert = dbFn<typeof db.upsertRecordEmbedding>("upsertRecordEmbedding");
  if (!iterate || !upsert) return { embedded: 0 };
  try {
    const records: CollectedReply[] = [];
    for await (const row of iterate(personaId, userId)) {
      if (signal?.aborted) return { embedded: 0 };
      records.push({
        id: row.id,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        kind: row.kind,
        speaker: row.speaker,
        act: row.act,
        emotion: row.emotion,
      });
    }
    const bursts = userBurstsForEmbedding(records);
    if (!bursts.length) return { embedded: 0 };
    const already = new Set<number>();
    const listed = dbFn<typeof db.listEmbeddedRecordIds>("listEmbeddedRecordIds");
    if (listed) {
      try {
        for (const id of await listed(personaId, userId, embedModelName())) already.add(id);
      } catch {
        /* missing mock or table — embed what we can */
      }
    }
    const pending = bursts.filter((burst) => !already.has(burst.recordId));
    let embedded = 0;
    const model = embedModelName();
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      if (signal?.aborted) break;
      const batch = pending.slice(i, i + EMBED_BATCH);
      const vectors = await embedTexts(
        batch.map((item) => item.text),
        { signal, model },
      );
      if (!vectors) break;
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec) continue;
        await upsert({
          userId,
          personaId,
          recordId: batch[j].recordId,
          model,
          dim: vec.length,
          vec: packEmbedding(vec),
        });
        embedded += 1;
      }
    }
    if (embedded > 0) invalidateEmbedCache(personaId);
    return { embedded };
  } catch {
    return { embedded: 0 };
  }
}

const embedJobs = new Map<string, AbortController>();

export function schedulePersonaEmbeddings(personaId: number, userId: number): void {
  const key = `${userId}:${personaId}`;
  embedJobs.get(key)?.abort();
  const controller = new AbortController();
  embedJobs.set(key, controller);
  void embedPersonaTurns({ personaId, userId, signal: controller.signal })
    .catch(() => {})
    .finally(() => {
      if (embedJobs.get(key) === controller) embedJobs.delete(key);
    });
}
