// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  profile: null as Record<string, unknown> | null,
  events: [] as Array<Record<string, unknown>>,
  confirm: vi.fn(),
  reject: vi.fn(),
  invalidate: vi.fn(),
  saveEvent: vi.fn(),
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
      list: { useQuery: () => ({ data: { events: fixtures.events, hint: "empty" } }) },
      save: { useMutation: () => ({ mutate: fixtures.saveEvent, isPending: false }) },
      mine: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    actProfile: {
      get: { useQuery: () => ({ data: { profile: fixtures.profile } }) },
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

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import V5FidelityEditors from "./V5FidelityEditors";

describe("the fifth-stage editors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.items = [];
    fixtures.profile = null;
    fixtures.events = [];
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

  it("lists the three most common replies next to each of the user's acts", () => {
    fixtures.profile = {
      samples: 40,
      unconditional: { answer: 40 },
      buckets: [],
      byUserAct: { ask: { answer: 18, tease: 2 } },
      measuredAt: "2026-01-01T00:00:00.000Z",
    };
    render(<V5FidelityEditors personaId={1} />);
    expect(screen.getByText(translate("zh", "v5.actAdjacencyTitle"))).toBeInTheDocument();
    expect(screen.getByText("在问一件事")).toBeInTheDocument();
    expect(screen.getByText(/回答被问到的事 90%/)).toBeInTheDocument();
    expect(screen.getByText(/开玩笑、损一下 10%/)).toBeInTheDocument();
  });

  it("shows the hours of a mined routine so they can be changed", () => {
    fixtures.events = [{
      id: "r1",
      kind: "routine",
      title: "周三下午上课",
      detail: "",
      whoSaid: "them",
      closed: false,
      source: "auto",
      verified: false,
      evidence: [{ at: "2022-03-02T08:11:23.000Z", snippet: "刚下课" }],
      schedule: { weekdays: [3], startHour: 14, endHour: 16 },
    }];
    render(<V5FidelityEditors personaId={1} />);
    expect(screen.getByText("周三下午上课")).toBeInTheDocument();
    expect(screen.getByDisplayValue("14")).toBeInTheDocument();
    expect(screen.getByDisplayValue("16")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "v5.routineHint"))).toBeInTheDocument();
    expect(screen.getByText(/刚下课/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(translate("zh", "v5.scheduleStart")), { target: { value: "15" } });
    expect(fixtures.saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      events: expect.arrayContaining([
        expect.objectContaining({ id: "r1", schedule: expect.objectContaining({ startHour: 15 }) }),
      ]),
    }));
  });
});
