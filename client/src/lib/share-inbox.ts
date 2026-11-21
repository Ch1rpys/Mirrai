/**
 * The files the OS share sheet handed to the service worker (C8.8).
 *
 * The worker stores a shared file in its own cache — `mirrai-share-inbox`,
 * apart from the app shell — and sends the browser to `/share-inbox`.
 * This module is the page's side of that: list what is waiting, read it,
 * import it through the streaming upload route, and delete it once it is
 * in.
 *
 * Everything returns "nothing" for a browser without the Cache API
 * rather than throwing: the page has an honest sentence for that case.
 */

/** The cache the service worker writes shared files into. */
export const SHARE_INBOX_CACHE = "mirrai-share-inbox";

export interface SharedFile {
  /** The cache key, which is also the URL the page reads it back with. */
  key: string;
  /** The name the file had in the app it was shared from. */
  name: string;
  /** The declared type, for the icon and the upload's Content-Type. */
  type: string;
  /** Bytes, so the page can say how large it is. */
  size: number;
}

/** Whether this browser has the Cache API at all. */
export function shareInboxSupported(): boolean {
  return typeof caches !== "undefined" && typeof caches.open === "function";
}

function filenameOf(response: Response | undefined, fallback: string): string {
  const header = response?.headers?.get("x-mirrai-filename");
  if (!header) return fallback;
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

/**
 * Everything waiting to be imported, oldest first.
 *
 * The entries are cache responses whose headers carry the original
 * name; the cache key itself is a URL and cannot be every possible file
 * name.
 */
export async function listSharedFiles(): Promise<SharedFile[]> {
  if (!shareInboxSupported()) return [];
  const cache = await caches.open(SHARE_INBOX_CACHE);
  const requests = await cache.keys();
  const files: SharedFile[] = [];
  for (const request of requests) {
    const response = await cache.match(request);
    if (!response) continue;
    let size = 0;
    try {
      size = (await response.clone().blob()).size;
    } catch {
      size = 0;
    }
    const key = typeof request === "string" ? request : request.url;
    files.push({
      key,
      name: filenameOf(response, "shared-file"),
      type: response.headers.get("content-type") || "application/octet-stream",
      size,
    });
  }
  return files;
}

/** The bytes of one shared file. */
export async function readSharedFile(file: SharedFile): Promise<Blob> {
  const cache = await caches.open(SHARE_INBOX_CACHE);
  const response = await cache.match(file.key);
  if (!response) throw new Error("The shared file is no longer there.");
  return response.blob();
}

/** Forgets one shared file. */
export async function deleteSharedFile(file: SharedFile): Promise<void> {
  if (!shareInboxSupported()) return;
  const cache = await caches.open(SHARE_INBOX_CACHE);
  await cache.delete(file.key);
}

/**
 * Forgets every shared file still waiting.
 *
 * Called when the page goes away: a file that was not imported should
 * not sit in the browser for ever. Already-imported ones were deleted
 * one by one as they went in.
 */
export async function clearShareInbox(): Promise<void> {
  if (!shareInboxSupported()) return;
  const cache = await caches.open(SHARE_INBOX_CACHE);
  const requests = await cache.keys();
  await Promise.all(requests.map((request) => cache.delete(request)));
}

/**
 * Imports one shared file into a persona through the streaming route.
 *
 * The route takes the raw bytes (C1.1) and answers with the file's id;
 * the page then continues to the import wizard with it. The cache entry
 * is deleted only after the server has accepted the file.
 */
export async function importSharedFile(
  file: SharedFile,
  personaId: number,
): Promise<{ fileId: number }> {
  const blob = await readSharedFile(file);
  const params = new URLSearchParams({
    personaId: String(personaId),
    name: file.name,
  });
  const response = await fetch(`/api/import/upload?${params.toString()}`, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": file.type || "application/octet-stream" },
    credentials: "include",
  });
  if (!response.ok) {
    let message = "";
    try {
      message = String(((await response.json()) as { error?: unknown }).error ?? "");
    } catch {
      message = "";
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { fileId?: unknown };
  await deleteSharedFile(file);
  return { fileId: Number(payload.fileId) };
}
