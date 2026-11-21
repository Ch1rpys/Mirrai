/*
 * Mirrai service worker.
 *
 * The app is local-first, so the point of the worker is to make the shell
 * load without a network — not to make conversations available offline.
 *
 * Privacy rule: nothing under /api/ or /uploads/ is ever cached. Those are
 * the user's conversations, their photos and their synthesised speech; they
 * belong on their machine and nowhere else.
 */

/**
 * The shell version. Bump it to invalidate the caches.
 *
 * The name is the whole invalidation mechanism: the activate step deletes
 * every cache whose name is not this one. So a constant name means the
 * cache is never invalidated, and the files in it that are *not* hashed by
 * the build — the manifest, the icons, the font — stayed at the version
 * from the very first install, for ever. A user who updated the app kept
 * the old icon and the old manifest.
 */
const CACHE_VERSION = "mirrai-BUILD";

/**
 * Where a file shared from another app waits for the user to import it.
 *
 * A separate cache on purpose: it does not belong to the app shell, the
 * shell's version name never has to change because of it, and the
 * activate step below must not delete it along with last build's shell.
 * The files here are the user's own exports — they leave with the tab
 * that imports them.
 */
const SHARE_CACHE = "mirrai-share-inbox";

/** The action the manifest declares for the OS share sheet. */
const SHARE_TARGET = "/share-target";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/fonts/MiSans-subset.woff2",
];

/** Paths that must never be written to the cache. */
function isPrivatePath(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/uploads/") ||
    pathname === "/api" ||
    pathname === "/uploads"
  );
}

/**
 * What the browser is shown when there is nothing to show.
 *
 * It was English only — and the app is not. The service worker cannot
 * read the app's own language setting (it has no access to the
 * browser's storage), but it does know the browser's language, and that
 * is what the person is reading.
 */
function offlineResponse() {
  const chinese = String(self.navigator?.language ?? "").toLowerCase().startsWith("zh");
  const html = chinese
    ? '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
        "<title>离线</title>" +
        '<body style="font-family:system-ui,sans-serif;padding:2rem">' +
        "<h1>离线</h1>" +
        "<p>这一页需要 Mirrai 正在运行。</p></body></html>"
    : '<!doctype html><html lang="en"><meta charset="utf-8">' +
        "<title>Offline</title>" +
        '<body style="font-family:system-ui,sans-serif;padding:2rem">' +
        "<h1>Offline</h1>" +
        "<p>This page needs Mirrai to be running.</p></body></html>";
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * The assets the built shell refers to.
 *
 * The shell is the HTML, and the HTML names the hashed script and style
 * files it loads. Those were not in the cache: the worker only cached
 * an asset when it was already controlling the page, and the worker is
 * registered on `load` — so the first load's assets were fetched
 * without it and never cached, and they were only cached from the
 * *second* load onwards.
 *
 * The consequence: a user who installed the app and then opened it
 * with no network got the cached HTML and a 404 for every script — a
 * blank white page. It only worked after the app had been opened online
 * twice.
 *
 * So the shell is read, and the assets it names are put in the same
 * cache.
 */
async function cacheShell() {
  const cache = await caches.open(CACHE_VERSION);
  // A single missing entry must not fail the whole install.
  await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));

  try {
    const response = await fetch("/", { cache: "no-store" });
    if (!response || !response.ok) return;
    const html = await response.clone().text();
    await cache.put("/", response.clone());

    const assets = [];
    const pattern = /(?:src|href)="(\/assets\/[^"]+)"/g;
    let match = pattern.exec(html);
    while (match !== null) {
      assets.push(match[1]);
      match = pattern.exec(html);
    }
    await Promise.allSettled(assets.map((url) => cache.add(url)));
  } catch {
    // No network at install time: the shell that is already cached is
    // what there is.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // The share inbox is not the app shell and outlives it: a
            // file shared a moment ago must still be there after an
            // update.
            .filter((key) => key !== CACHE_VERSION && key !== SHARE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Takes the files the OS share sheet posted, and sends the browser to
 * the page that imports them.
 *
 * The manifest's `share_target` makes the operating system POST a
 * `multipart/form-data` body here. The worker cannot answer an app page
 * on its own, so it stores the files where the page can read them and
 * answers with a 303 to `/share-inbox` — the browser then opens that
 * page as a normal navigation.
 *
 * The file's name goes into a header because a cache key is a URL and
 * not every name is one; it is percent-encoded so a Chinese file name
 * survives intact.
 */
async function receiveSharedFiles(request) {
  let entries = [];
  try {
    const form = await request.formData();
    entries = form.getAll("files").filter((entry) => entry && typeof entry === "object" && "arrayBuffer" in entry);
  } catch {
    entries = [];
  }
  const cache = await caches.open(SHARE_CACHE);
  const stamp = Date.now();
  for (let index = 0; index < entries.length; index += 1) {
    const file = entries[index];
    const name = typeof file.name === "string" && file.name ? file.name : "shared-" + index;
    const key = SHARE_TARGET + "-inbox/" + stamp + "-" + index;
    const headers = new Headers({
      "content-type": file.type || "application/octet-stream",
      "x-mirrai-filename": encodeURIComponent(name),
    });
    await cache.put(key, new Response(file, { headers }));
  }
  return Response.redirect(new URL("/share-inbox", self.location.origin).toString(), 303);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  /**
   * The share sheet's POST comes before the GET-only rule.
   *
   * It is the one non-GET request the worker answers; it writes into the
   * share inbox and nothing else (see `receiveSharedFiles`).
   */
  if (request.method === "POST") {
    const shared = new URL(request.url);
    if (shared.origin === self.location.origin && shared.pathname === SHARE_TARGET) {
      event.respondWith(receiveSharedFiles(request));
    }
    return;
  }

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Private data is always fetched straight from the server.
  if (isPrivatePath(url.pathname)) return;

  // Navigations: try the network first so a deployed update is picked up,
  // and fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put("/", copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          // `caches.match` resolves with nothing when the shell was never
          // cached, and answering a navigation with nothing is a network
          // error — the browser says "this site can't be reached" rather
          // than showing the app.
          const cached = await caches.match("/", { ignoreSearch: true });
          return cached ?? offlineResponse();
        }),
    );
    return;
  }

  // Static assets: cache first. The build hashes their names, so a changed
  // file is a new URL.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      });
    }),
  );
});

/**
 * The words on a notification that did not bring its own.
 *
 * Same rule as the offline page: the worker cannot read the app's
 * language setting, so it uses the browser's language. The two
 * sentences are fixed. Nothing from the payload is interpolated into
 * them.
 */
function notificationCopy() {
  const chinese = String(self.navigator?.language ?? "").toLowerCase().startsWith("zh");
  if (chinese) return { title: "Mirrai", body: "有一条新消息" };
  return { title: "Mirrai", body: "There is a new message" };
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const fallback = notificationCopy();
  const title = typeof payload.title === "string" && payload.title ? payload.title : fallback.title;
  const body = typeof payload.body === "string" && payload.body ? payload.body : fallback.body;
  const tag = payload.personaId != null ? "persona-" + payload.personaId : "mirrai";
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification && event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const open = windowClients.find((client) => client.url && client.url.indexOf(self.location.origin) === 0);
      if (open) {
        open.postMessage({ type: "navigate", url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
