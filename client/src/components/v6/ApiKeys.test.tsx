// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { translate } from "@/i18n";

const list = vi.fn();
const createMutation = vi.fn();
const revokeMutation = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    apiKey: {
      list: { useQuery: () => list() },
      create: { useMutation: () => createMutation() },
      revoke: { useMutation: () => revokeMutation() },
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
  toast: { success: vi.fn(), error: vi.fn() },
}));

import ApiKeys from "./ApiKeys";

const KEY = "mk_abcdefghijklmnopqrstuvwxyz0123456789ABCD";

function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: { keys: [] },
    isLoading: false,
    isError: false,
    refetch,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockReturnValue(queryResult());
  createMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  revokeMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

describe("the API key panel", () => {
  it("says the endpoint does nothing until a key exists", () => {
    render(<ApiKeys />);
    expect(screen.getByText(translate("zh", "apiKeys.title"))).toBeInTheDocument();
    expect(screen.getByTestId("api-keys-empty")).toBeInTheDocument();
  });

  it("shows a key's prefix and never the key itself", () => {
    list.mockReturnValue(queryResult({
      data: {
        keys: [{
          id: 3,
          name: "编辑器",
          prefix: KEY.slice(0, 12),
          scopes: ["chat"],
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date("2026-03-01T00:00:00Z"),
        }],
      },
    }));
    render(<ApiKeys />);
    expect(screen.getByText("编辑器")).toBeInTheDocument();
    expect(screen.getByText(`${KEY.slice(0, 12)}…`)).toBeInTheDocument();
    expect(screen.queryByText(KEY)).toBeNull();
    expect(screen.getByText(translate("zh", "apiKeys.neverUsed"))).toBeInTheDocument();
  });

  it("creates a key and shows it once", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ key: KEY, id: 9, prefix: KEY.slice(0, 12) });
    createMutation.mockReturnValue({ mutateAsync, isPending: false });
    render(<ApiKeys />);
    fireEvent.change(screen.getByLabelText(translate("zh", "apiKeys.nameLabel")), {
      target: { value: "我的编辑器" },
    });
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "apiKeys.create") }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ name: "我的编辑器", scopes: ["chat"] }));
    expect(await screen.findByTestId("api-key-fresh")).toBeInTheDocument();
    expect(screen.getByText(KEY)).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "apiKeys.createdOnce"))).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the read scope when it is asked for", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ key: KEY, id: 9, prefix: KEY.slice(0, 12) });
    createMutation.mockReturnValue({ mutateAsync, isPending: false });
    render(<ApiKeys />);
    fireEvent.change(screen.getByLabelText(translate("zh", "apiKeys.nameLabel")), {
      target: { value: "只读" },
    });
    fireEvent.click(screen.getByLabelText(translate("zh", "apiKeys.scopeRead")));
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "apiKeys.create") }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ name: "只读", scopes: ["chat", "read"] }),
    );
  });

  it("asks before revoking a key", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    revokeMutation.mockReturnValue({ mutateAsync, isPending: false });
    list.mockReturnValue(queryResult({
      data: {
        keys: [{
          id: 3,
          name: "编辑器",
          prefix: KEY.slice(0, 12),
          scopes: ["chat"],
          lastUsedAt: new Date("2026-03-02T00:00:00Z"),
          revokedAt: null,
          createdAt: new Date("2026-03-01T00:00:00Z"),
        }],
      },
    }));
    render(<ApiKeys />);
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "apiKeys.revoke") }));
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "apiKeys.revokeConfirm") }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 3 }));
  });

  it("gives a retry when the list could not be read", () => {
    list.mockReturnValue(queryResult({ data: undefined, isError: true }));
    render(<ApiKeys />);
    expect(screen.getByRole("alert")).toHaveTextContent(translate("zh", "apiKeys.loadFailed"));
    fireEvent.click(screen.getByRole("button", { name: translate("zh", "common.retry") }));
    expect(refetch).toHaveBeenCalled();
  });
});
