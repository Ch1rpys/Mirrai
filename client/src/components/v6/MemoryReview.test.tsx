// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const keep = vi.fn();
const remove = vi.fn();
const refetch = vi.fn();
const invalidate = vi.fn();

let rows: Array<{
  id: number;
  title: string;
  description: string | null;
  category: string;
  messageId: number | null;
}> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    memory: {
      listFromPersona: {
        useQuery: () => ({ data: rows, isLoading: false, isError: false, refetch }),
      },
      keepFromPersona: {
        useMutation: () => ({ mutate: keep, isPending: false }),
      },
      delete: {
        useMutation: () => ({ mutate: remove, isPending: false }),
      },
    },
    useUtils: () => ({
      memory: { list: { invalidate } },
    }),
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

import MemoryReview from "./MemoryReview";

describe("memories taken from what the persona said", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [
      {
        id: 7,
        title: "周三下午有课",
        description: null,
        category: "anchor",
        messageId: 11,
      },
    ];
  });

  it("renders nothing when there are none", () => {
    rows = [];
    const { container } = render(<MemoryReview personaId={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps one by clearing its source line", async () => {
    const user = userEvent.setup();
    render(<MemoryReview personaId={5} />);

    expect(
      screen.getByText(translate("zh", "chat.memory.fromPersona", { count: 1 })),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "留着" }));
    expect(keep).toHaveBeenCalledWith({ id: 7 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes one", async () => {
    const user = userEvent.setup();
    render(<MemoryReview personaId={5} />);

    await user.click(screen.getByRole("button", { name: "删掉" }));
    expect(remove).toHaveBeenCalledWith({ id: 7 });
    expect(keep).not.toHaveBeenCalled();
  });
});
