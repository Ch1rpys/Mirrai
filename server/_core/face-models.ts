/**
 * The face model weights, served from this machine (B7.8).
 *
 * The browser never fetches a model from a CDN. The package ships the
 * weights under `model/`; this module finds that directory inside the
 * installed package and answers only for the files on a fixed list.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * What the avatar picker needs: the tiny detector, the 68-point
 * landmarks, and the recognition net.
 *
 * The manifests name the `.bin` shards, so all of them are on the list.
 */
export const FACE_MODEL_FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
] as const;

export type FaceModelFile = (typeof FACE_MODEL_FILES)[number];

const ALLOWED = new Set<string>(FACE_MODEL_FILES);

/** The package's model directory, or null when the package is not installed. */
export function faceModelsDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve("@vladmandic/face-api/package.json");
    const dir = path.join(path.dirname(packageJson), "model");
    return existsSync(dir) ? dir : null;
  } catch {
    const fallback = path.resolve(process.cwd(), "node_modules/@vladmandic/face-api/model");
    return existsSync(fallback) ? fallback : null;
  }
}

/** Whether the weights are here and complete enough to load. */
export function faceModelsAvailable(): boolean {
  const dir = faceModelsDir();
  if (!dir) return false;
  return FACE_MODEL_FILES.every((file) => existsSync(path.join(dir, file)));
}

/**
 * Resolves one whitelisted file.
 *
 * The name comes from the request path, so anything not on the list —
 * `../package.json`, another model, a file written later — is refused
 * before it touches the disk.
 */
export function resolveFaceModelFile(name: string): string | null {
  if (!ALLOWED.has(name)) return null;
  const dir = faceModelsDir();
  if (!dir) return null;
  const file = path.join(dir, name);
  return existsSync(file) ? file : null;
}
