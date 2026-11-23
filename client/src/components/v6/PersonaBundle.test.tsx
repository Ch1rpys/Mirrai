// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { translate } from "@/i18n";

const list = vi.fn();
const refetch = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      list: { useQuery: () => list() },
    },
  },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import PersonaBundle from "./PersonaBundle";

const personas = [
  { id: 3, name: "小满", locked: false },
  { id: 4, name: "锁着的", locked: true },
];

function listResult(overrides: Record<string, unknown> = {}) {
  return { data: personas, isLoading: false, isError: false, refetch, ...overrides };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  list.mockReturnValue(listResult());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:x"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function exportResponse(): Response {
  return new Response(new Blob(["a bundle"]), {
    status: 200,
    headers: {
      "content-disposition":
        "attachment; filename=\"____.mirrai-persona\"; filename*=UTF-8''%E5%B0%8F%E6%BB%A1.mirrai-persona",
    },
  });
}

describe("the persona bundle panel", () => {
  it("lists the personas that are not locked", () => {
    render(<PersonaBundle />);
    expect(screen.getByText(translate("zh", "bundle.title"))).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "小满" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "锁着的" })).toBeNull();
  });

  it("exports the chosen persona with the chosen parts", async () => {
    fetchMock.mockResolvedValue(exportResponse());
    render(<PersonaBundle />);
    fireEvent.click(screen.getByRole("checkbox", { name: translate("zh", "bundle.includeConversation") }));
    fireEvent.change(screen.getByLabelText(translate("zh", "bundle.passphraseLabel")), {
      target: { value: "a long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "bundle.exportButton") }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/persona/bundle");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      personaId: 3,
      include: { memories: true, records: true, conversation: true },
      passphrase: "a long passphrase",
    });
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(translate("zh", "bundle.exported"));
  });

  it("shows the server's sentence when the export fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "没有这个分身。" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }));
    render(<PersonaBundle />);
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "bundle.exportButton") }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("没有这个分身。"));
  });

  it("imports a file and sends its passphrase in a header", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      personaId: 12,
      name: "小满",
      counts: { records: 2, memories: 1 },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    render(<PersonaBundle />);
    const file = new File(["bundle"], "小满.mirrai-persona", { type: "application/octet-stream" });
    fireEvent.change(screen.getByLabelText(translate("zh", "bundle.fileLabel")), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText(translate("zh", "bundle.importPassphraseLabel")), {
      target: { value: "a long passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "bundle.importButton") }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/persona/import-bundle");
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(Buffer.from(headers["x-mirrai-bundle-passphrase"], "base64").toString("utf-8")).toBe(
      "a long passphrase",
    );
    expect(init.body).toBe(file);
    expect(refetch).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("keeps the import button off until a file is picked", () => {
    render(<PersonaBundle />);
    expect(screen.getByRole("button", { name: translate("zh", "bundle.importButton") })).toBeDisabled();
  });

  it("shows the server's sentence when the import fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "口令不对，或者文件被改过，打不开。" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));
    render(<PersonaBundle />);
    const file = new File(["bundle"], "x.mirrai-persona");
    fireEvent.change(screen.getByLabelText(translate("zh", "bundle.fileLabel")), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "bundle.importButton") }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("口令不对，或者文件被改过，打不开。"),
    );
  });
});
