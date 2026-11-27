// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The goodbye, and the way out.
 *
 * Two things have to be true on this page at the same time: the farewell
 * is there, and the exit is there. A goodbye that only seals the door
 * leaves the user with the words they never said and nowhere to take
 * them.
 */
let persona: any;
/** The diaries the server sends, and how many there are in all. */
let diaryItems: any[] = [];
let diaryTotal = 0;
const updateSettings = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    encryption: { status: { useQuery: () => ({ data: { enabled: true } }) } },
    persona: {
      get: { useQuery: () => ({ data: persona }) },
      getSettings: {
        useQuery: () => ({ data: {}, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      setKeptQuotes: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateSettings: { useMutation: () => ({ mutate: updateSettings, isPending: false }) },
      seal: {
        set: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        requestOpen: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        cancelRequest: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
    relationship: {
      list: { useQuery: () => ({ data: { events: [] } }) },
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    memory: { list: { useQuery: () => ({ data: { items: [] } }) } },
    diary: { list: { useQuery: () => ({ data: { items: diaryItems, total: diaryTotal } }) } },
    record: {
      marks: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
      search: {
        useQuery: () => ({ data: { exact: [], similar: null }, isLoading: false }),
      },
    },
    unsaid: {
      list: {
        useQuery: () => ({
          data: { items: [] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      complete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    outbound: {
      list: { useQuery: () => ({ data: { letters: [] } }) },
      addOwn: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ persona: { get: { invalidate: vi.fn() } } }),
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1/graduation", vi.fn()],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

// The panel brings its own data access with it.
vi.mock("@/components/OutboundLetters", () => ({
  default: () => <div data-testid="outbound-letters" />,
}));

vi.mock("@/components/v6/GraduationReasons", () => ({
  default: () => <div data-testid="graduation-reasons" />,
}));

import Graduation from "./Graduation";

describe("the goodbye", () => {
  beforeEach(() => {
    diaryItems = [];
    diaryTotal = 0;
  });

  it("says how many diaries there are, not how many it fetched", () => {
    /**
     * The count was the length of the list — and the list is capped by
     * the query — so a persona with two hundred diaries read as if
     * there were thirty.
     */
    diaryItems = [
      { id: 1, date: "2026-03-01", summary: "今天聊了很多。", highlights: [], emotionalArc: null, quotes: [], reflection: null, messageCount: 12, personaName: "小A" },
    ];
    diaryTotal = 200;

    render(<Graduation />);

    expect(
      screen.getByText(translate("zh", "graduationPage.diariesCount", { count: 1, total: 200 })),
    ).toBeInTheDocument();
  });

  beforeEach(() => {
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      farewellLetter: "我一直都知道，只是没说。",
      graduatedAt: new Date("2026-03-01T00:00:00Z"),
      farewellDegraded: false,
      personaData: null,
    };
  });

  it("offers the four endings and saves the chosen one (C6.6)", () => {
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      farewellLetter: null,
      graduatedAt: null,
      personaData: null,
      settings: { graduationKind: "farewell" },
    };
    render(<Graduation />);
    expect(screen.getByText("这一次，是哪一种结束")).toBeInTheDocument();
    expect(screen.getByText("和 小A 告别")).toBeInTheDocument();
    expect(screen.getByText("我把话说出口了")).toBeInTheDocument();
    expect(screen.getByText("我们和好了")).toBeInTheDocument();
    expect(screen.getByText("我不再害怕了")).toBeInTheDocument();
    fireEvent.click(screen.getByText("我不再害怕了"));
    expect(updateSettings).toHaveBeenCalledWith({
      id: 1,
      patch: { graduationKind: "not_afraid" },
    });
  });

  it("closes a non-farewell ending with its own words (C6.6)", () => {
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      farewellLetter: "嗯。",
      graduatedAt: new Date("2026-03-01T00:00:00Z"),
      personaData: null,
      settings: { graduationKind: "not_afraid" },
    };
    render(<Graduation />);
    expect(
      screen.getAllByText("这里可以合上了。毕业的是害怕，不是 小A。").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "记一条关系事件" })).toBeNull();
  });

  it("closes the said-it ending with its own words (C6.6)", () => {
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      farewellLetter: "嗯。",
      graduatedAt: new Date("2026-03-01T00:00:00Z"),
      personaData: null,
      settings: { graduationKind: "said_it" },
    };
    render(<Graduation />);
    expect(
      screen.getAllByText("这里可以合上了。毕业的是害怕，不是 小A。").length,
    ).toBeGreaterThan(0);
    // Only "we made up" asks for the relationship event.
    expect(screen.queryByRole("button", { name: "记一条关系事件" })).toBeNull();
  });

  it("asks to mark the day when the two of them made up (C6.6)", () => {
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      farewellLetter: "嗯。",
      graduatedAt: new Date("2026-03-01T00:00:00Z"),
      personaData: null,
      settings: { graduationKind: "reconciled" },
    };
    render(<Graduation />);
    expect(screen.getByRole("button", { name: "记一条关系事件" })).toBeInTheDocument();
  });

  it("shows the farewell", () => {
    render(<Graduation />);
    expect(screen.getByText("我一直都知道，只是没说。")).toBeInTheDocument();
  });

  it("shows both letters, and a box when the user has not picked one (C6.5)", () => {
    render(<Graduation />);
    expect(
      screen.getByText(translate("zh", "mutualLetters.theirLabel", { name: "小A" })),
    ).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "mutualLetters.yourLabel"))).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        translate("zh", "mutualLetters.placeholder", { name: "小A" }),
      ),
    ).toBeInTheDocument();
  });

  it("has the exit", () => {
    render(<Graduation />);
    expect(screen.getByTestId("outbound-letters")).toBeInTheDocument();
  });

  it("does not claim the letter is simplified when it is not", () => {
    render(<Graduation />);
    expect(screen.queryByText(translate("zh", "graduationPage.simplified"))).toBeNull();
  });

  it("shows what the second pass kept, and what it cut", () => {
    // The letter is written in two passes, and the subtraction is the
    // interesting half. It used to be computed and thrown away.
    persona.farewellDraft = {
      kept: ["我一直都知道，只是没说。"],
      removed: ["我希望你一切都好。"],
    };
    render(<Graduation />);
    expect(screen.getByText(translate("zh", "graduationPage.keptHeading"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "graduationPage.removedHeading"))).toBeInTheDocument();
    expect(screen.getByText("我希望你一切都好。")).toBeInTheDocument();
  });

  it("says so when the letter is the simplified one", () => {
    // The letter comes from two passes, and when the second one cannot
    // finish, the older single-pass letter is used. The reader has to be
    // able to tell the two apart.
    persona.farewellDegraded = true;
    render(<Graduation />);
    expect(screen.getByText(translate("zh", "graduationPage.simplified"))).toBeInTheDocument();
  });
});
