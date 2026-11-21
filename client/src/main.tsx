import { trpc } from "@/lib/trpc";
import { markAppLocked } from "@/lib/app-lock";
import { markEncryptionLocked } from "@/lib/encryption-lock";
import { registerServiceWorker } from "@/lib/pwa";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000),
      networkMode: "online",
    },
    mutations: {
      networkMode: "online",
    },
  },
});

onlineManager.setEventListener((setOnline) => {
  const onOnline = () => setOnline(true);
  const onOffline = () => setOnline(false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  /**
   * The code, by name.
   *
   * It used to compare the message with an English string — "Please
   * login (10001)" — because the error's data carried a *number*
   * (`-32001`), not a name. So the comparison never matched, and an
   * expired session never sent the user to the sign-in page: they were
   * left on a screen that could not load anything, with a toast that
   * said "please login" in a Chinese interface, in English.
   *
   * The server now puts the name in the data.
   */
  const isUnauthorized = error.data?.code === "UNAUTHORIZED";

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

/**
 * The server's answer when the app lock is closed (C8.4).
 *
 * The transport says `FORBIDDEN` because tRPC's codes are a closed set;
 * the app's own name for it travels in `data.code`. Any answer that says
 * the session is locked puts the lock screen up — the interface already
 * holds the lobby in memory, so a screen is not optional.
 */
const isLockedError = (error: unknown): boolean =>
  error instanceof TRPCClientError && error.data?.code === "LOCKED";

/**
 * The server's answer when an encrypted account's key is not in memory
 * (C8.5). The content is ciphertext, so the screen asks for the account
 * password instead of showing the lobby it already has.
 */
const isEncryptionLockedError = (error: unknown): boolean =>
  error instanceof TRPCClientError && error.data?.code === "ENCRYPTION_LOCKED";

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    if (isLockedError(error)) {
      markAppLocked();
      return;
    }
    if (isEncryptionLockedError(error)) {
      markEncryptionLocked();
      return;
    }
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    if (isLockedError(error)) {
      markAppLocked();
      return;
    }
    if (isEncryptionLockedError(error)) {
      markEncryptionLocked();
      return;
    }
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        // The server's own words — the errors, the notices — have to be in
        // the language of the person reading them. The client says which
        // language that is.
        const headers = new Headers(init?.headers ?? {});
        // The storage can refuse — private mode, cookies disabled, a
        // full quota — and `typeof localStorage !== "undefined"` only
        // proves the global exists. The read used to throw there, which
        // broke every API call: the interface looked fine and nothing
        // worked.
        let locale: string | null = null;
        try {
          locale = typeof localStorage !== "undefined"
            ? localStorage.getItem("mirrai-locale")
            : null;
        } catch {
          locale = null;
        }
        headers.set(
          "x-mirrai-locale",
          locale === "en" ? "en" : locale === "zh-Hant" ? "zh-Hant" : "zh",
        );
        return globalThis.fetch(input, {
          ...(init ?? {}),
          headers,
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

// The service worker makes the app shell load without a network. It never
// caches conversations.
registerServiceWorker();
