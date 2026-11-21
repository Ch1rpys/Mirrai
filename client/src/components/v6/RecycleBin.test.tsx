// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const listState: any = { value: {} };
const restoreMutate = vi.fn();
const purgeMutate = vi.fn();
const invalidateDeleted = vi.fn();
const invalidatePersonas = vi.fn();
const confirm = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => confirm,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      persona: {
        listDeleted: { invalidate: invalidateDeleted },
        list: { invalidate: invalidatePersonas },
      },
    }),
    persona: {
      listDeleted: { useQuery: () => listState.value },
      restore: {
        useMutation: (options: any) => ({ mutate: restoreMutate, isPending: false, options }),
      },
      purge: {
        useMutation: (options: any) => ({ mutate: purgeMutate, isPending: false, options }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: (text: string) => toastSuccess(text), error: (text: string) => toastError(text) },
}));

import RecycleBin from "./RecycleBin";

const DELETED = {
  id: 7,
  name: "小满",
  avatarUrl: null,
  relationshipDesc: "朋友",
  chatCount: 3,
  deletedAt: "2026-03-01T04:00:00.000Z",
};

describe("the recycle bin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listState.value = {
      data: { personas: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    confirm.mockResolvedValue(true);
  });

  it("says it is still reading rather than that the bin is empty", () => {
    listState.value = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    render(<RecycleBin />);
    expect(screen.getByTestId("recycle-bin").textContent).toContain(
      translate("zh", "recycle.loading"),
    );
    expect(screen.getByTestId("recycle-bin").textContent).not.toContain(
      translate("zh", "recycle.empty"),
    );
  });

  it("reports a failed read and offers to try again", async () => {
    const refetch = vi.fn();
    listState.value = { data: undefined, isLoading: false, isError: true, refetch };
    render(<RecycleBin />);

    expect(screen.getByTestId("recycle-bin").textContent).toContain(
      translate("zh", "recycle.loadFailed"),
    );
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "recycle.retry") }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says the bin is empty — not that the read failed", () => {
    render(<RecycleBin />);
    const text = screen.getByTestId("recycle-bin").textContent ?? "";
    expect(text).toContain(translate("zh", "recycle.hint"));
    expect(text).toContain(translate("zh", "recycle.empty"));
    expect(text).not.toContain(translate("zh", "recycle.loadFailed"));
  });

  it("lists a deleted persona with the day it was deleted", () => {
    listState.value = {
      data: { personas: [DELETED] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<RecycleBin />);
    const text = screen.getByTestId("recycle-row").textContent ?? "";
    expect(text).toContain("小满");
    expect(text).toContain(translate("zh", "recycle.restore"));
    expect(text).toContain(translate("zh", "recycle.purge"));
  });

  it("restores the persona", async () => {
    listState.value = {
      data: { personas: [DELETED] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<RecycleBin />);
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "recycle.restore") }));
    expect(restoreMutate).toHaveBeenCalledWith({ id: 7 });
  });

  it("asks before deleting for good, and names what will be cleared", async () => {
    listState.value = {
      data: { personas: [DELETED] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<RecycleBin />);

    await userEvent.click(screen.getByRole("button", { name: translate("zh", "recycle.purge") }));

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: translate("zh", "recycle.purgeConfirm", { name: "小满" }),
        destructive: true,
      }),
    );
    expect(purgeMutate).toHaveBeenCalledWith({ id: 7 });
  });

  it("does nothing when the confirmation is declined", async () => {
    confirm.mockResolvedValue(false);
    listState.value = {
      data: { personas: [DELETED] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<RecycleBin />);
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "recycle.purge") }));
    expect(purgeMutate).not.toHaveBeenCalled();
  });
});
