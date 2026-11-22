// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";
import { SHARE_INBOX_CACHE } from "@/lib/share-inbox";

/**
 * The page a file shared into the app lands on (C8.8).
 *
 * The Cache API is faked: the point is the page's promise — it lists
 * what is waiting, deletes each file once the server has it, and leaves
 * nothing behind when the page goes away.
 */

const navigate = vi.fn();
const importResponse = { ok: true, status: 200 };

vi.mock("wouter", () => ({
  useLocation: () => ["/share-inbox", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      list: {
        useQuery: () => ({
          data: [
            { id: 5, name: "小满" },
            { id: 6, name: "锁着的小林", locked: true },
          ],
          isLoading: false,
        }),
      },
    },
  },
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn() },
}));

type Store = Map<string, Response>;

/** The smallest Cache API the page needs, in memory. */
function installCaches() {
  const stores = new Map<string, Store>();
  const storeFor = (name: string): Store => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    return store;
  };
  const cacheOf = (name: string) => ({
    put: async (key: string | Request, value: Response) => {
      storeFor(name).set(typeof key === "string" ? key : key.url, value);
    },
    match: async (key: string | Request) =>
      storeFor(name).get(typeof key === "string" ? key : key.url),
    keys: async () => Array.from(storeFor(name).keys()).map((url) => new Request(url)),
    delete: async (key: string | Request) =>
      storeFor(name).delete(typeof key === "string" ? key : key.url),
    add: async () => undefined,
  });
  const caches = {
    open: async (name: string) => cacheOf(name),
    keys: async () => Array.from(stores.keys()),
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: caches,
  });
  return { stores, storeFor };
}

const ORIGIN = "http://localhost:3000";

async function seed(stores: ReturnType<typeof installCaches>, files: Array<[string, string]>) {
  const store = stores.storeFor(SHARE_INBOX_CACHE);
  for (const [index, [name, body]] of files.entries()) {
    const url = `${ORIGIN}/share-target-inbox/1-${index}`;
    store.set(
      url,
      new Response(body, {
        headers: {
          "content-type": "text/csv",
          "x-mirrai-filename": encodeURIComponent(name),
        },
      }),
    );
  }
}

import ShareInbox from "./ShareInbox";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ fileId: 7 }), {
      status: importResponse.status,
      headers: { "content-type": "application/json" },
    })),
  );
});

describe("the share inbox", () => {
  it("lists the files the share sheet left, and forgets them on import", async () => {
    const caches = installCaches();
    await seed(caches, [
      ["聊天记录.csv", "a,b"],
      ["export.json", "{}"],
    ]);

    const { unmount } = render(<ShareInbox />);

    expect(await screen.findByText("聊天记录.csv")).toBeInTheDocument();
    expect(screen.getByText("export.json")).toBeInTheDocument();
    // A locked persona is not offered: importing into it would be refused.
    expect(screen.queryByRole("option", { name: "小满" })).toBeInTheDocument();
    // The locked persona is filtered out by name, not hidden behind an
    // empty fixture.
    expect(screen.queryByRole("option", { name: "锁着的小林" })).toBeNull();

    fireEvent.change(screen.getByLabelText(translate("zh", "shareInbox.pickPersona")), {
      target: { value: "5" },
    });
    const importButtons = screen.getAllByRole("button", {
      name: translate("zh", "shareInbox.import"),
    });
    fireEvent.click(importButtons[0]);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/upload/7"));
    // The file goes through the same streaming upload as a hand-picked
    // one: the persona and the original name ride in the query string.
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/import/upload?personaId=5&name=%E8%81%8A%E5%A4%A9%E8%AE%B0%E5%BD%95.csv");
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    expect(caches.storeFor(SHARE_INBOX_CACHE).size).toBe(1);
    unmount();
  });

  it("clears what was not imported when the page goes away", async () => {
    const caches = installCaches();
    await seed(caches, [["聊天记录.csv", "a,b"]]);

    const { unmount } = render(<ShareInbox />);
    expect(await screen.findByText("聊天记录.csv")).toBeInTheDocument();

    unmount();
    await waitFor(() => expect(caches.storeFor(SHARE_INBOX_CACHE).size).toBe(0));
  });

  it("says there is nothing when the cache is empty", async () => {
    installCaches();
    render(<ShareInbox />);
    expect(await screen.findByText(translate("zh", "shareInbox.empty"))).toBeInTheDocument();
  });

  it("offers to create a persona even when some already exist", async () => {
    const caches = installCaches();
    await seed(caches, [["聊天记录.csv", "a,b"]]);
    render(<ShareInbox />);
    expect(await screen.findByText("聊天记录.csv")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: translate("zh", "shareInbox.createPersona") }),
    );
    expect(navigate).toHaveBeenCalledWith("/onboarding");
  });

  it("keeps the file when the upload is refused, and says why", async () => {
    const caches = installCaches();
    await seed(caches, [["聊天记录.csv", "a,b"]]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "导入被拒绝" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<ShareInbox />);
    expect(await screen.findByText("聊天记录.csv")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(translate("zh", "shareInbox.pickPersona")), {
      target: { value: "5" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: translate("zh", "shareInbox.import") }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    // The cache entry is deleted only after the server accepted it.
    expect(caches.storeFor(SHARE_INBOX_CACHE).size).toBe(1);
  });
});
