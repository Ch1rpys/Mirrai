// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const { list, deleteMemory, rejectCandidate, updateSettings, invalidate, navigate } = vi.hoisted(() => ({
  list: vi.fn(),
  deleteMemory: vi.fn(),
  rejectCandidate: vi.fn(),
  updateSettings: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    inference: {
      list: { useQuery: () => list() },
      rejectCandidate: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            rejectCandidate(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    memory: {
      delete: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            deleteMemory(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    persona: {
      updateSettings: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            updateSettings(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({ inference: { list: { invalidate } } }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/inferences", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import Inferences from "./Inferences";

const SECTIONS = [
  {
    id: "me",
    titleKey: "inference.sectionMe",
    items: [
      {
        id: "me-address",
        labelKey: "inference.me.addressStyle",
        source: "written",
        detail: "叫我阿树",
      },
    ],
  },
  {
    id: "persona-5",
    titleKey: "inference.sectionPersona",
    titleParams: { name: "小满" },
    items: [
      {
        id: "style-conflict",
        labelKey: "styleProfile.conflict",
        source: "measured",
        detail: "{\"episodes\": 6}",
        action: { kind: "toggleStyleKey", styleKey: "conflict", disabled: false },
      },
      {
        id: "style-mirror",
        labelKey: "styleProfile.mirror",
        source: "measured",
        detail: "{}",
        action: { kind: "toggleStyleKey", styleKey: "mirror", disabled: true },
        disabled: true,
      },
      {
        id: "memory-5-11",
        labelKey: "inference.field.memoriesThem",
        labelParams: { name: "小满" },
        source: "mined",
        detail: "生日是 5 月 21 日",
        action: { kind: "deleteMemory", memoryId: 11 },
      },
      {
        id: "person-p-mom",
        labelKey: "inference.field.people",
        source: "mined",
        detail: "我妈 · 家人 · 9 次",
        evidence: ["我妈下周要来"],
        action: { kind: "rejectCandidate", candidateKind: "people", key: "p-mom" },
      },
      {
        id: "doc-personality",
        labelKey: "inference.field.personality",
        source: "written",
        detail: "温柔",
        action: { kind: "editPersona", personaId: 5 },
      },
    ],
  },
];

describe("the inference view page (C10.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockReturnValue({
      data: { sections: SECTIONS },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("has the two blocks", () => {
    render(<Inferences />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("应用推断了什么");
    expect(screen.getByRole("heading", { level: 2, name: "关于我" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "关于 小满" })).toBeInTheDocument();
    // The source of each row is on screen, not only the content.
    expect(screen.getAllByText("从记录里量的").length).toBeGreaterThan(0);
    expect(screen.getAllByText("自动找的，等你确认").length).toBeGreaterThan(0);
    expect(screen.getAllByText("你写的").length).toBeGreaterThan(0);
  });

  it("does not render a failed read as an empty view", () => {
    list.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<Inferences />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("关于我")).toBeNull();
  });

  it("expands a row to show its content and evidence", async () => {
    const user = userEvent.setup();
    render(<Inferences />);
    expect(screen.queryByText("我妈下周要来")).toBeNull();
    // The fourth expandable row is the mined person with the quoted line.
    const expanders = screen.getAllByRole("button", { name: "看内容和依据" });
    await user.click(expanders[4]!);
    expect(screen.getByText("我妈 · 家人 · 9 次")).toBeInTheDocument();
    expect(screen.getByText("依据")).toBeInTheDocument();
    expect(screen.getByText("我妈下周要来")).toBeInTheDocument();
  });

  it("deletes a memory the user does not want", async () => {
    const user = userEvent.setup();
    render(<Inferences />);
    await user.click(screen.getByRole("button", { name: "删掉这条记忆" }));
    expect(deleteMemory).toHaveBeenCalledWith({ id: 11 });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("rejects a candidate", async () => {
    const user = userEvent.setup();
    render(<Inferences />);
    await user.click(screen.getByRole("button", { name: "拒绝这条候选" }));
    expect(rejectCandidate).toHaveBeenCalledWith({
      personaId: 5,
      candidateKind: "people",
      key: "p-mom",
    });
  });

  it("turns a style measurement off", async () => {
    const user = userEvent.setup();
    render(<Inferences />);
    await user.click(screen.getAllByRole("button", { name: "不用这一项" })[0]!);
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { disabledProfiles: ["mirror", "conflict"] },
    });
  });

  it("turns a style measurement back on", async () => {
    // The same page with the conflict profile already turned off. The
    // row says so and offers the way back.
    const enabledAlready = JSON.parse(JSON.stringify(SECTIONS));
    enabledAlready[1].items = enabledAlready[1].items.filter(
      (item: { id: string }) => item.id !== "style-mirror",
    );
    enabledAlready[1].items[0].disabled = true;
    enabledAlready[1].items[0].action.disabled = true;
    list.mockReturnValue({
      data: { sections: enabledAlready },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Inferences />);
    await user.click(screen.getByRole("button", { name: "恢复" }));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 5,
      patch: { disabledProfiles: [] },
    });
  });

  it("sends the user to the persona editor", async () => {
    const user = userEvent.setup();
    render(<Inferences />);
    await user.click(screen.getByRole("button", { name: "去改人设" }));
    expect(navigate).toHaveBeenCalledWith("/persona/5/edit");
  });
});
