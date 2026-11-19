// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The sticker library panel.
 *
 * A sticker with a picture is a picture; one the export only named is a
 * name. Turning one off and deleting one are both calls the record
 * owner makes, so both are exercised here.
 */

const listResult = vi.fn();
const setEnabled = vi.fn();
const remove = vi.fn();
const upload = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    sticker: {
      list: { useQuery: () => listResult() },
      setEnabled: { useMutation: () => ({ mutate: setEnabled, isPending: false }) },
      delete: { useMutation: () => ({ mutate: remove, isPending: false }) },
      upload: { useMutation: () => ({ mutate: upload, isPending: false }) },
    },
    useUtils: () => ({
      sticker: { list: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import StickerLibrary from "./StickerLibrary";

const twoStickers = {
  data: {
    limit: 500,
    stickers: [
      {
        id: 1,
        key: "label:狗狗探头",
        label: "狗狗探头",
        usesByThem: 12,
        usesByMe: 0,
        enabled: true,
        imageUrl: null,
        lastUsedAt: null,
      },
      {
        id: 2,
        key: "abc",
        label: "猫猫叹气",
        usesByThem: 5,
        usesByMe: 0,
        enabled: false,
        imageUrl: "/uploads/personas/1/5/stickers/abc.png",
        lastUsedAt: null,
      },
    ],
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

describe("the sticker library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listResult.mockReturnValue(twoStickers);
  });

  it("shows each sticker, how often it was sent, and its picture when there is one", () => {
    render(<StickerLibrary personaId={5} name="小满" />);
    expect(screen.getByText(translate("zh", "stickerLibrary.title"))).toBeInTheDocument();
    expect(screen.getByText("狗狗探头")).toBeInTheDocument();
    expect(screen.getByText("发过 12 次")).toBeInTheDocument();
    expect(screen.getByAltText("猫猫叹气")).toHaveAttribute(
      "src",
      "/uploads/personas/1/5/stickers/abc.png",
    );
    expect(screen.getByText(translate("zh", "stickerLibrary.noImage"))).toBeInTheDocument();
  });

  it("turns one off", async () => {
    const user = userEvent.setup();
    render(<StickerLibrary personaId={5} name="小满" />);
    const checkbox = screen.getAllByRole("checkbox")[0]!;
    await user.click(checkbox);
    expect(setEnabled).toHaveBeenCalledWith({
      personaId: 5,
      stickerId: 1,
      enabled: false,
    });
  });

  it("asks before deleting a sticker", async () => {
    const user = userEvent.setup();
    render(<StickerLibrary personaId={5} name="小满" />);
    await user.click(screen.getAllByText(translate("zh", "common.delete"))[0]!);
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByText(translate("zh", "common.confirm")));
    expect(remove).toHaveBeenCalledWith({ personaId: 5, stickerId: 1 });
  });

  it("says the record has none rather than showing an empty grid", () => {
    listResult.mockReturnValue({
      data: { limit: 500, stickers: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<StickerLibrary personaId={5} name="小满" />);
    expect(
      screen.getByText(translate("zh", "stickerLibrary.empty", { name: "小满" })),
    ).toBeInTheDocument();
  });

  it("does not render a failed read as an empty library", async () => {
    const refetch = vi.fn();
    listResult.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    const user = userEvent.setup();
    render(<StickerLibrary personaId={5} name="小满" />);
    expect(
      screen.getByText(translate("zh", "stickerLibrary.loadFailed")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/还没有/)).toBeNull();
    await user.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });
});
