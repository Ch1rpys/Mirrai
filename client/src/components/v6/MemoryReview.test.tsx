// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { ConfirmProvider } from "@/components/ConfirmDialog";

const update = vi.fn();
const remove = vi.fn();
const adjudicate = vi.fn();

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
});
