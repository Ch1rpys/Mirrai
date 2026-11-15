// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const fixtures = vi.hoisted(() => ({
  items: [] as Array<{
    key: string;
    reason: string;
    messageId: number;
    kind: "suppression" | "act" | "memory" | "display";
    snippet?: string;
    sampledAct?: string | null;
  }>,
  confirm: vi.fn(),
  reject: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      suppression: { list: { invalidate: fixtures.invalidate } },
      actProfile: { get: { invalidate: fixtures.invalidate } },
    }),
    suppression: {
      list: { useQuery: () => ({ data: { rules: [], hint: "还看不出来" } }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      mine: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    lifeEvent: {
      list: { useQuery: () => ({ data: { events: [], hint: "empty" } }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      mine: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    actProfile: {
      get: { useQuery: () => ({ data: { profile: null } }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    fidelity: {
      candidates: { useQuery: () => ({ data: { items: fixtures.items } }) },
      reject: { useMutation: () => ({ mutate: fixtures.reject, isPending: false }) },
      confirm: { useMutation: () => ({ mutate: fixtures.confirm, isPending: false }) },
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

import V5FidelityEditors from "./V5FidelityEditors";

describe("the fifth-stage editors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.items = [];
  });

  it("shows the four editors", () => {
    render(<V5FidelityEditors personaId={1} />);
    expect(screen.getByText(translate("zh", "v5.suppressionsTitle"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "v5.lifeEventsTitle"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "v5.actProfileTitle"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "v5.feedbackTitle"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "v5.noFeedback"))).toBeInTheDocument();
  });

  it("confirms a word mark into a subtraction", async () => {
    fixtures.items = [{
      key: "word:9",
      reason: "word",
      messageId: 9,
      kind: "suppression",
      snippet: "你好吗？",
    }];
    render(<V5FidelityEditors personaId={1} />);
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "v5.confirmFeedback") }));
    expect(fixtures.confirm).toHaveBeenCalledWith(
      { personaId: 1, key: "word:9" },
      expect.anything(),
    );
  });

  it("confirms an act mark with the sampled action", async () => {
    fixtures.items = [{
      key: "act:4",
      reason: "act",
      messageId: 4,
      kind: "act",
      snippet: "你应该早点睡",
      sampledAct: "advise",
    }];
    render(<V5FidelityEditors personaId={1} />);
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "v5.confirmAct") }));
    expect(fixtures.confirm).toHaveBeenCalledWith(
      { personaId: 1, key: "act:4", act: "advise" },
      expect.anything(),
    );
  });
});
