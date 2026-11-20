// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The rehearsal room (C3.2).
 *
 * The page has one job the tests hold it to: it is practice, and it says
 * so. The top note is there in both modes, the cards carry their
 * proportions, and the sentence only leaves the room when the user keeps
 * it.
 */
const run = vi.fn();
const keep = vi.fn();
let runOptions: any = null;
let personaValue: any = {
  id: 5,
  name: "小满",
  graduationStatus: null,
  presence: "active",
};
const navigate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: { get: { useQuery: () => ({ data: personaValue, isLoading: false, isError: false, refetch: vi.fn() }) } },
    rehearsal: {
      run: {
        useMutation: (options: any) => {
          runOptions = options;
          return { mutate: run, isPending: false };
        },
      },
      keep: {
        useMutation: (options: any) => ({
          mutate: (input: any) => {
            keep(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    safety: {
      resources: { useQuery: () => ({ data: { resources: [] }, isError: false, isLoading: false }) },
    },
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/rehearsal", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Rehearsal from "./Rehearsal";

describe("the rehearsal room", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personaValue = { id: 5, name: "小满", graduationStatus: null, presence: "active" };
  });

  it("says what the room is, in both modes", () => {
    const user = userEvent.setup();
    const { unmount } = render(<Rehearsal />);
    expect(screen.getByText(/不是 小满 的回答/)).toBeInTheDocument();
    act(() => runOptions.onSuccess({ mode: "variants", variants: [], id: 1 }));
    expect(screen.getByText(/不是 小满 的回答/)).toBeInTheDocument();
    unmount();

    render(<Rehearsal />);
    act(() => runOptions.onSuccess({ mode: "my_side_only", id: 2 }));
    expect(screen.getByText(/不是 小满 的回答/)).toBeInTheDocument();
    expect(screen.getByText(/答案只有 小满 能给/)).toBeInTheDocument();
  });

  it("shows a card per possible response, with its proportion", async () => {
    const user = userEvent.setup();
    render(<Rehearsal />);
    await user.type(screen.getByLabelText(translate("zh", "rehearsal.placeholder")), "对不起");
    await user.click(screen.getByRole("button", { name: translate("zh", "rehearsal.run") }));
    expect(run).toHaveBeenCalledWith({ personaId: 5, line: "对不起" });
    act(() => runOptions.onSuccess({
      mode: "variants",
      id: 3,
      variants: [
        { act: "acknowledge", share: 0.5, text: "嗯，我在听。", silent: false },
        { act: "silence", share: 0.2, text: null, silent: true },
        { act: "comfort", share: 0.1, text: null, silent: false },
      ],
    }));
    expect(screen.getByText("大约十次里有 5 次 · 应一声")).toBeInTheDocument();
    expect(screen.getByText("嗯，我在听。")).toBeInTheDocument();
    expect(screen.getAllByText("小满 可能不回")).toHaveLength(2);
    expect(screen.getByText(translate("zh", "rehearsal.notGenerated"))).toBeInTheDocument();
  });

  it("keeps the practised line only when the user asks", async () => {
    const user = userEvent.setup();
    render(<Rehearsal />);
    await user.type(screen.getByLabelText(translate("zh", "rehearsal.placeholder")), "对不起");
    await user.click(screen.getByRole("button", { name: translate("zh", "rehearsal.run") }));
    act(() => runOptions.onSuccess({ mode: "variants", variants: [], id: 7 }));
    expect(keep).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: translate("zh", "rehearsal.keepLine", { name: "小满" }) }),
    );
    expect(keep).toHaveBeenCalledWith({ id: 7 });
  });

  it("leads to the wording assistant through the way-out list", async () => {
    const user = userEvent.setup();
    render(<Rehearsal />);
    await user.type(screen.getByLabelText(translate("zh", "rehearsal.placeholder")), "对不起");
    await user.click(screen.getByRole("button", { name: translate("zh", "rehearsal.run") }));
    act(() => runOptions.onSuccess({ mode: "my_side_only", id: 9 }));
    await user.click(screen.getByRole("button", { name: translate("zh", "rehearsal.sayAnotherWay") }));
    expect(keep).toHaveBeenCalledWith({ id: 9 });
    expect(navigate).toHaveBeenCalledWith("/persona/5/graduation");
  });

  it("is closed for a persona that has gone to sleep", () => {
    personaValue = { id: 5, name: "小满", graduationStatus: "graduated", presence: "asleep" };
    render(<Rehearsal />);
    expect(screen.getByText(translate("zh", "rehearsal.unavailable"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: translate("zh", "rehearsal.run") })).toBeNull();
  });
});
