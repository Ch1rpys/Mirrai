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
  return Buffer.from(quantizeInt8(l2Normalize(vec)).buffer);
}

export function unpackEmbedding(buf: Buffer | Uint8Array): number[] {
  return dequantizeInt8(Int8Array.from(buf));
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

/**
 * Embed texts with the local Ollama daemon.
 *
 * Returns `null` when Ollama is down, the model is missing, or the
 * response is not a matching list of vectors. An empty input is `[]`.
 */
export async function embedTexts(
  texts: string[],
  options?: { signal?: AbortSignal; model?: string },
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const model = options?.model ?? embedModelName();
  const url = `${ENV.ollamaUrl.replace(/\/+$/, "")}/api/embed`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
      signal: options?.signal,
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
