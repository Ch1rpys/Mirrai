// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * "Read this line" (C3.4).
 *
 * The page shows three things: the rules the user confirmed, the times
 * the person really said it, and what followed. It never says what the
 * line means — the fixed note at the bottom is the promise.
 */
const decode = vi.fn();
let decodedState: any = { data: undefined, isFetching: false, isError: false, refetch: vi.fn() };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: {
        useQuery: () => ({
          data: { id: 5, name: "小满" },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    record: {
      decode: {
        useQuery: (...a: unknown[]) => {
          decode(...a);
          return decodedState;
        },
      },
    },
    safety: {
      resources: { useQuery: () => ({ data: { resources: [] }, isError: false, isLoading: false }) },
    },
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

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/decode", vi.fn()],
}));

import Decode from "./Decode";

const result = {
  rules: [
    {
      id: "r1",
      trigger: ["就嗯？"],
      meaning: "她生气了",
      rendering: "更短、更冷",
      evidence: [],
    },
  ],
  precedents: [
    {
      id: 12,
      content: "就嗯？",
      at: "2023-03-17T04:00:00.000Z",
      similarity: 1,
      before: [
        { id: 11, role: "user", speaker: "阿树", content: "嗯", kind: "text", meta: null, at: "2023-03-17T03:59:00.000Z", emotion: null },
      ],
      after: [
        { id: 13, role: "assistant", speaker: "小满", content: "哦。", kind: "text", meta: null, at: "2023-03-17T04:30:00.000Z", emotion: "distant" },
      ],
    },
  ],
  after: { count: 6, gapMedianSec: 3600, states: [{ state: "distant", n: 6 }] },
  text: "就嗯？",
};

describe("read this line", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decodedState = { data: undefined, isFetching: false, isError: false, refetch: vi.fn() };
  });

  it("asks for the line and then shows the three blocks", async () => {
    const user = userEvent.setup();
    decodedState = { data: result, isFetching: false, isError: false, refetch: vi.fn() };
    render(<Decode />);
    await user.type(screen.getByLabelText(translate("zh", "decode.placeholder", { name: "小满" })), "就嗯？");
    await user.click(screen.getByRole("button", { name: translate("zh", "decode.submit") }));
    expect(decode).toHaveBeenLastCalledWith(
      { personaId: 5, text: "就嗯？" },
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText(translate("zh", "decode.rulesTitle"))).toBeInTheDocument();
    expect(screen.getByText("她生气了")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "decode.precedentsTitle", { name: "小满" }))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "decode.afterTitle"))).toBeInTheDocument();
    expect(screen.getByText(/下一次说话平均隔了 60 分钟/)).toBeInTheDocument();
    expect(screen.getByText(/被标成了「疏离」/)).toBeInTheDocument();
  });

  it("keeps the fixed note on the page", () => {
    decodedState = { data: result, isFetching: false, isError: false, refetch: vi.fn() };
    render(<Decode />);
    expect(
      screen.getByText(translate("zh", "decode.fixedNote", { name: "小满" })),
    ).toBeInTheDocument();
  });

  it("says so when the record has never said it", () => {
    decodedState = {
      data: { ...result, precedents: [], after: { count: 0, gapMedianSec: null, states: [] } },
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<Decode />);
    // Said in both the precedents block and the "what followed" block.
    expect(
      screen.getAllByText(translate("zh", "decode.noPrecedents", { name: "小满" })),
    ).toHaveLength(2);
  });

  it("opens the context without leaving the page", async () => {
    const user = userEvent.setup();
    decodedState = { data: result, isFetching: false, isError: false, refetch: vi.fn() };
    render(<Decode />);
    expect(screen.queryByText("哦。")).toBeNull();
    await user.click(screen.getByRole("button", { name: translate("zh", "decode.showContext") }));
    expect(screen.getByText("哦。")).toBeInTheDocument();
    expect(screen.getByText("嗯")).toBeInTheDocument();
  });

  it("shows the crisis card instead of the three blocks when the line is a crisis (C3.4)", async () => {
    const user = userEvent.setup();
    // The server short-circuits the decoder and answers with the card
    // flag only (WP12's rule: every piece of user input is read for
    // crisis language first, and a hit does nothing else).
    decodedState = { data: { crisis: true }, isFetching: false, isError: false, refetch: vi.fn() };
    render(<Decode />);
    await user.type(
      screen.getByLabelText(translate("zh", "decode.placeholder", { name: "小满" })),
      "我不想活了",
    );
    await user.click(screen.getByRole("button", { name: translate("zh", "decode.submit") }));
    expect(decode).toHaveBeenLastCalledWith(
      { personaId: 5, text: "我不想活了" },
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "safety.crisisTitle"))).toBeInTheDocument();
    // The three result blocks are not rendered: the crisis card is the
    // whole answer.
    expect(screen.queryByText(translate("zh", "decode.rulesTitle"))).toBeNull();
    expect(
      screen.queryByText(translate("zh", "decode.precedentsTitle", { name: "小满" })),
    ).toBeNull();
    expect(screen.queryByText(translate("zh", "decode.afterTitle"))).toBeNull();
  });
});
