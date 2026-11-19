// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { ConfirmProvider } from "@/components/ConfirmDialog";

const update = vi.fn();
const remove = vi.fn();
const adjudicate = vi.fn();
const linkMedia = vi.fn();
const unlinkMedia = vi.fn();
const suggestions = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    memory: {
      update: {
        useMutation: () => ({ mutate: update, isPending: false }),
      },
      delete: {
        useMutation: () => ({ mutate: remove, isPending: false }),
      },
      adjudicate: {
        useMutation: () => ({ mutate: adjudicate, isPending: false }),
      },
      suggestMedia: { useQuery: () => suggestions() },
      linkMedia: { useMutation: () => ({ mutate: linkMedia, isPending: false }) },
      unlinkMedia: { useMutation: () => ({ mutate: unlinkMedia, isPending: false }) },
    },
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

import MemoryReview from "./MemoryReview";

const items = [
  { id: 1, title: "第一次见面", description: null, category: "memory", subject: "them" },
  { id: 2, title: "我今天好累", description: null, category: "memory", subject: "me" },
  { id: 3, title: "周三下午有课", description: null, category: "memory", subject: "said" },
];

describe("the memory ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suggestions.mockReturnValue({
      data: { photos: [{ id: 11, url: "/uploads/a.jpg", at: null, width: 4, height: 4 }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("renders nothing when there are none", () => {
    const { container } = render(
      <ConfirmProvider>
        <MemoryReview personaId={5} items={[]} />
      </ConfirmProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows three groups, and confirming a said memory updates it", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <MemoryReview personaId={5} items={items} />
      </ConfirmProvider>,
    );

    expect(screen.getByRole("heading", { name: "关于 TA 的" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "关于我的" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "分身说过的" })).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "chat.memory.saidHint"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "这是真的" }));
    expect(update).toHaveBeenCalledWith({ id: 3, subject: "them" });
  });

  it("shows an attached photo and can take it off", async () => {
    const user = userEvent.setup();
    const withPhoto = [
      {
        ...items[0]!,
        media: [{ id: 11, url: "/uploads/a.jpg", at: null, width: 4, height: 4 }],
      },
    ];
    render(
      <ConfirmProvider>
        <MemoryReview personaId={5} items={withPhoto} onChanged={() => {}} />
      </ConfirmProvider>,
    );
    expect(screen.getByTitle(translate("zh", "memoryPhoto.attached"))).toHaveAttribute(
      "href",
      "/uploads/a.jpg",
    );
    await user.click(screen.getByRole("button", { name: translate("zh", "memoryPhoto.remove") }));
    expect(unlinkMedia).toHaveBeenCalledWith({ memoryId: 1, mediaId: 11 });
  });

  it("suggests a near photo and attaches the one picked", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <MemoryReview personaId={5} items={items} onChanged={() => {}} />
      </ConfirmProvider>,
    );
    await user.click(screen.getAllByText(translate("zh", "memoryPhoto.attach"))[0]!);
    await user.click(
      screen.getByRole("button", { name: translate("zh", "memoryPhoto.pick") }),
    );
    expect(linkMedia).toHaveBeenCalledWith({ memoryId: 1, mediaId: 11 });
  });

  it("deletes a memory after the confirmation", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <MemoryReview personaId={5} items={items} />
      </ConfirmProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: "删除记忆" })[0]!);
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: 1 }));
  });
});
