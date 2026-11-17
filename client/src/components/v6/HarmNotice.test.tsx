// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import type { HarmReport } from "@shared/harm";

const { decide, invalidate } = vi.hoisted(() => ({
  decide: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      decideHarm: {
        useMutation: () => ({ mutate: decide, isPending: false, variables: undefined }),
      },
      get: { invalidate },
    },
    safety: {
      resources: { useQuery: () => ({ data: [], isError: false, isLoading: false }) },
    },
    useUtils: () => ({
      persona: { get: { invalidate } },
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

vi.mock("@/components/CrisisCard", () => ({
  default: () => <div role="dialog">resources</div>,
}));

import HarmNotice from "./HarmNotice";

const report: HarmReport = {
  categories: [
    {
      kind: "belittle",
      count: 5,
      examples: [1, 2, 3],
      snippets: ["你真没用", "你就是个废物"],
    },
  ],
  decision: "pending",
};

describe("the harm notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects not learning by default", () => {
    render(<HarmNotice personaId={5} name="小满" report={report} />);
    expect(
      screen.getByRole("radio", { name: translate("zh", "harm.remove") }),
    ).toBeChecked();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/家暴/);
    expect(text).not.toMatch(/PUA/);
    expect(text).not.toMatch(/有毒/);
  });

  it("tells the server when a choice is made", async () => {
    const user = userEvent.setup();
    render(<HarmNotice personaId={5} name="小满" report={report} />);
    await user.click(screen.getByRole("radio", { name: translate("zh", "harm.keep") }));
    expect(decide).toHaveBeenCalledWith({ id: 5, decision: "keep" });
  });

  it("renders nothing after a decision", () => {
    const { container } = render(
      <HarmNotice personaId={5} name="小满" report={{ ...report, decision: "remove" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
