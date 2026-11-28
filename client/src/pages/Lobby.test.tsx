// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSyncExternalStore } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { previousDateKey, zonedDateKey } from "@shared/timezone";

/**
 * The lobby, and the pin.
 *
 * Pinning is the one thing a person can do to say "this one first" — and
 * it is not a sort option, it is a property of the persona. A pinned
 * persona sits at the top whatever the list is sorted by, and the sort
 * only decides the order of the ones that are not pinned.
 *
 * That is a small rule and an easy one to break, so it is worth a test.
 */
const update = vi.fn();
const listRefetch = vi.fn();

/** What the account has turned on (C9.8). */
const authState = vi.hoisted(() => ({ groupChat: false }));

/**
 * The personas the server sends back.
 *
 * The list is a store of its own, so a test can change it and have
 * the page notice — the way the server's answer changes it.
 */
let personas: any[];
let personasVersion = 0;
const personaListeners = new Set<() => void>();
function subscribePersonas(listener: () => void) {
  personaListeners.add(listener);
  return () => {
    personaListeners.delete(listener);
  };
}
function setPersonas(next: any[]) {
  personas = next;
  personasVersion += 1;
  for (const listener of personaListeners) listener();
}
/** Whether the list is still on its way. */
let personasLoading = false;
/** Whether the list could not be read. */
let personasFailed = false;
/** Days the user spoke, for the streak that used to sit on this page. */
let dailyActivity: Array<{ date: string; userCount: number; count: number }> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    setup: { useQuery: () => ({ data: { hasLlmProvider: true, hasUserProvider: false } }) },
    persona: {
      list: {
        useQuery: () => {
          // The page notices when the list changes.
          useSyncExternalStore(subscribePersonas, () => personasVersion);
          return {
            data: personas,
            refetch: listRefetch,
            isLoading: personasLoading,
            isError: personasFailed,
          };
        },
      },
      stats: { useQuery: () => ({ data: { totalPersonas: 2, totalChats: 10, todayChats: 1 } }) },
      update: { useMutation: () => ({ mutate: update, isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      restore: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createSandbox: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      awaken: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      dailyActivity: { useQuery: () => ({ data: dailyActivity }) },
      recentActivity: { useQuery: () => ({ data: [] }) },
    },
    record: {
      onThisDay: { useQuery: () => ({ data: [] }) },
    },
    letter: {
      // The mailbox entry is on the lobby's nav (C8.2).
      unreadCount: { useQuery: () => ({ data: { total: 0 } }) },
    },
    lock: {
      // The "lock now" button is on the lobby's nav (C8.4).
      status: { useQuery: () => ({ data: { enabled: false } }) },
      lockNow: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      verifyPin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ invalidate: vi.fn() }),
    reminder: {
      list: { useQuery: () => ({ data: [] }) },
      dismiss: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    template: {
      list: { useQuery: () => ({ data: [] }) },
      instantiate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: {
      milestones: {
        useQuery: () => ({
          data: { firstLetterAt: null, firstOutboundSentAt: null, firstFarewellAt: null },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    // The user's own zone — the page reads the clock in it.
    user: {
      username: "测试",
      timezone: "Asia/Shanghai",
      features: { groupChat: authState.groupChat },
    },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  useParams: () => ({}),
  Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// The real dictionary, so a missing key fails the test rather than
// rendering an empty label.
vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

// The theme comes from a provider the test does not need.
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

// The panels that bring their own data access with them.
vi.mock("@/components/MoodCheckIn", () => ({ default: () => <div /> }));

import Lobby from "./Lobby";

/** A persona, in the shape the server sends it. */
function makePersona(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: "小A",
    relationshipDesc: "前女友",
    analysisStatus: "ready",
    graduationStatus: "active",
    presence: "active",
    reachability: "reachable",
    relationshipEnded: false,
    isPinned: false,
    chatCount: 0,
    createdAt: new Date("2026-01-01").toISOString(),
    ...overrides,
  };
}

describe("the lobby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personas = [];
    personasLoading = false;
    personasFailed = false;
    dailyActivity = [];
    authState.groupChat = false;
  });

  it("does not say the user has no personas while the list is on its way", () => {
    // The query has no answer yet, so there is no list — and "no list"
    // used to mean "no personas", so the page said the user had none
    // and offered to make one. On a slow connection every visit began
    // with an invitation to create a duplicate.
    personas = undefined as any;
    personasLoading = true;

    render(<Lobby />);

    expect(screen.queryByText(translate("zh", "lobby.emptyState.title"))).toBeNull();
  });

  it("shows a sealed persona as a closed card with only the day (C6.2)", () => {
    personas = [makePersona({
      id: 5,
      name: "小A",
      settings: { seal: { until: "2099-04-01", earlyOpen: "never" } },
    })];
    render(<Lobby />);
    expect(screen.getByText("小A · 封存到 2099-04-01")).toBeInTheDocument();
    // No countdown, no days.
    expect(screen.queryByText(/还有 \d+ 天/)).toBeNull();
    expect(screen.queryByText(/封存到 2099-04-01。还有/)).toBeNull();
  });

  it("gives the sealed card a way to lift the seal (C6.2)", () => {
    // Sealing is not a one-way door: the card is where the user comes
    // back to it, so the card has to carry the way in to the seal
    // controls. Before this link the only surface rendering them was the
    // edit page, which read `persona.get` and was itself refused while
    // sealed.
    personas = [makePersona({
      id: 5,
      name: "小A",
      settings: { seal: { until: "2099-04-01", earlyOpen: "never" } },
    })];
    render(<Lobby />);
    const manage = screen.getByRole("link", { name: translate("zh", "seal.manage") });
    expect(manage.getAttribute("href")).toBe("/persona/5/seal");
  });

  it("does not show the seal controls for a persona that is still open (C6.2)", () => {
    personas = [makePersona({ id: 5, name: "小A" })];
    render(<Lobby />);
    expect(screen.queryByRole("link", { name: translate("zh", "seal.manage") })).toBeNull();
  });

  it("opens a closed card's three kept lines, and only on a closed card (C6.4)", () => {
    const quotes = {
      keptQuotes: [
        { recordId: 1, text: "晚安呀", at: "2024-05-01T21:00:00.000Z" },
        { recordId: 2, text: "树树 我在", at: "2024-05-02T21:00:00.000Z" },
        { recordId: 3, text: "早呀", at: "2024-05-03T08:00:00.000Z" },
      ],
    };
    personas = [
      makePersona({ id: 5, name: "封存的", settings: { seal: { until: "2099-04-01", earlyOpen: "never" }, ...quotes } }),
      makePersona({ id: 6, name: "毕业的", graduationStatus: "graduated", settings: quotes }),
      makePersona({ id: 7, name: "还在的", settings: quotes }),
    ];
    render(<Lobby />);

    // The graduated ones are folded away; the dormant card's lines are
    // read after unfolding it.
    fireEvent.click(screen.getByText(translate("zh", "lobby.directory.graduated", { count: 1 })));

    // The sealed card and the dormant card open to the three lines; the
    // card that is still open for talking does not carry a farewell.
    const title = translate("zh", "keepThree.keptTitle");
    expect(screen.getAllByText(title)).toHaveLength(2);
    expect(screen.getAllByText("晚安呀")).toHaveLength(2);
    expect(screen.getAllByText("早呀")).toHaveLength(2);
    // The sealed card still does not count days.
    expect(screen.queryByText(/还有 \d+ 天/)).toBeNull();
  });

  it("says the user has no personas when there are none", () => {
    render(<Lobby />);

    // The empty state is the truth here — the list came back and it was
    // empty.
    expect(screen.getByText(translate("zh", "lobby.emptyState.title"))).toBeInTheDocument();
  });

  it("puts a pinned persona first, whatever the sort is", () => {
    // The unpinned one is the newer of the two, so a plain "recent" sort
    // would put it first. The pin has to beat that.
    personas = [
      makePersona({ id: 1, name: "没置顶的", isPinned: false, createdAt: new Date("2026-06-01").toISOString() }),
      makePersona({ id: 2, name: "置顶的", isPinned: true, createdAt: new Date("2026-01-01").toISOString() }),
    ];

    render(<Lobby />);

    // The name appears in more than one panel, so the card headings are
    // what the order of the list is read from.
    const names = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent)
      .filter((text) => text === "置顶的" || text === "没置顶的");
    expect(names).toEqual(["置顶的", "没置顶的"]);
  });

  it("pins and unpins a persona", async () => {
    const user = userEvent.setup();
    personas = [makePersona({ id: 5, name: "小A", isPinned: false })];

    render(<Lobby />);
    await user.click(screen.getByTitle(translate("zh", "lobby.card.pin")));

    expect(update).toHaveBeenCalledWith({ id: 5, isPinned: true });
  });

  it("unpins a persona that was pinned", async () => {
    const user = userEvent.setup();
    personas = [makePersona({ id: 5, name: "小A", isPinned: true })];

    render(<Lobby />);
    await user.click(screen.getByTitle(translate("zh", "lobby.card.pin")));

    expect(update).toHaveBeenCalledWith({ id: 5, isPinned: false });
  });

  it("keeps the order of the ones that are not pinned", () => {
    // The list is sorted by the last conversation by default, so the one
    // you spoke to most recently comes first — and the pinned one comes
    // before both.
    personas = [
      makePersona({
        id: 1,
        name: "甲",
        isPinned: false,
        lastChatAt: new Date("2026-01-01").toISOString(),
      }),
      makePersona({
        id: 2,
        name: "乙",
        isPinned: false,
        lastChatAt: new Date("2026-05-01").toISOString(),
      }),
      makePersona({
        id: 3,
        name: "丙",
        isPinned: true,
        lastChatAt: new Date("2026-03-01").toISOString(),
      }),
    ];

    render(<Lobby />);

    const names = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent)
      .filter((text) => ["甲", "乙", "丙"].includes(text));
    // 丙 is pinned, so it is first even though it was spoken to before 乙.
    // The rest keep the order the sort gave them.
    expect(names).toEqual(["丙", "乙", "甲"]);
  });

  it("puts the focus into the sort menu when it opens", async () => {
    /**
     * The items are reached with the arrow keys, the way a menu's items
     * are — so the focus has to be in the menu.
     *
     * It was not: nothing moved it there, so the arrow-key handler
     * (which lives on the menu) never received a key event, and Tab
     * skipped the items. The order could not be changed at all without
     * a mouse — while the button announced a menu.
     */
    const user = userEvent.setup();
    personas = [makePersona()];

    render(<Lobby />);

    /**
     * The sort button, and not another one whose name happens to
     * contain the same two characters — the persona's quote is one of
     * twelve, and one of them says 「你最近在想什么呢？」.
     */
    const sortButton = screen
      .getAllByRole("button", { name: /最近|recent/i })
      .find((button) => button.getAttribute("aria-haspopup") === "menu");
    expect(sortButton).toBeTruthy();
    await user.click(sortButton!);

    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    // The focus is inside the menu.
    await waitFor(
      () => {
        expect(
          screen.getAllByRole("menuitem").some((item) => document.activeElement === item),
        ).toBe(true);
      },
      { timeout: 3000 },
    );

    // And the arrow keys move between the items.
    await user.keyboard("{ArrowDown}");
    const after = screen.getAllByRole("menuitem");
    expect(after.some((item) => document.activeElement === item)).toBe(true);
  });

  it("greets the user in their own clock", () => {
    /**
     * The hour was the machine's.
     *
     * So the greeting was wrong for up to eight hours a day for
     * anybody whose own zone is not the machine's — and the same page
     * uses the user's stored zone for the heatmap, the streak and the
     * calendar, so the screen disagreed with itself.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Ten at night in Shanghai is two in the afternoon in Greenwich.
    vi.setSystemTime(new Date("2026-03-14T14:00:00Z"));
    // And the machine's own zone is Greenwich, so the machine's hour
    // and the user's hour are not the same.
    const machineZone = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      personas = [makePersona()];
      render(<Lobby />);
      // Ten at night in Shanghai — so the night greeting, while the
      // machine's own clock says it is the afternoon.
      expect(screen.getByText(new RegExp(translate("zh", "lobby.greetings.night.text")))).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(translate("zh", "lobby.greetings.afternoon.text")))).toBeNull();
    } finally {
      if (machineZone === undefined) delete process.env.TZ;
      else process.env.TZ = machineZone;
      vi.useRealTimers();
    }
  });

  it("keeps a tab stop in the filter list when the chosen filter disappears", async () => {
    /**
     * A filter whose count fell to zero stopped being drawn — and the
     * selection stayed on it. So no drawn tab had a tab stop, the whole
     * list was skipped by the Tab key, and the directory below showed
     * nothing with no tab looking selected.
     */
    const user = userEvent.setup();
    personas = [
      makePersona({ id: 1, analysisStatus: "analyzing" }),
      makePersona({ id: 2, analysisStatus: "ready" }),
      makePersona({ id: 3, analysisStatus: "ready" }),
    ];

    render(<Lobby />);

    const analysing = screen.getByRole("tab", { name: /解析中/ });
    await user.click(analysing);

    // The one analysing persona is done, so the tab is gone.
    setPersonas([
      makePersona({ id: 1, analysisStatus: "ready" }),
      makePersona({ id: 2, analysisStatus: "ready" }),
      makePersona({ id: 3, analysisStatus: "ready" }),
    ]);
    /**
     * The selection falls back to a tab that is still there — so the
     * list has a tab stop, and the directory below is not empty with
     * no tab looking selected.
     */
    await waitFor(() => {
      const all = screen
        .getAllByRole("tab")
        .find((tab) => /全部/.test(tab.textContent ?? ""));
      expect(all?.getAttribute("aria-selected")).toBe("true");
      expect(all?.getAttribute("tabindex")).toBe("0");
    });
  });

  it("folds the graduated ones away until they are asked for", async () => {
    const user = userEvent.setup();
    personas = [
      makePersona({ id: 1, name: "还在的", graduationStatus: "active" }),
      makePersona({ id: 2, name: "已经毕业的", graduationStatus: "graduated" }),
    ];

    render(<Lobby />);

    // The graduated one is not in the list yet — it is folded away.
    expect(screen.queryByText("已经毕业的")).toBeNull();
    expect(screen.getAllByText("还在的").length).toBeGreaterThan(0);

    // But there is a way to reach it, and it says how many are folded away.
    const toggle = screen.getByText(
      translate("zh", "lobby.directory.graduated", { count: 1 }),
    );
    await user.click(toggle);

    expect(screen.getByText("已经毕业的")).toBeInTheDocument();
  });

  it("does not put a daily letter in a persona's mouth", () => {
    /**
     * A ready persona used to get a sentence from a fixed pool, with
     * a catchphrase stuck on the front and a nickname at the end, under
     * "TA 想对你说". The words were the app's, signed as them.
     */
    personas = [makePersona({ analysisStatus: "ready", graduationStatus: "active" })];

    render(<Lobby />);

    expect(screen.queryByText("TA 想对你说")).toBeNull();
    for (const line of [
      "今天也想你了呢~",
      "你今天开心吗？",
      "好想和你聊聊天",
      "今天的天气让我想起了你",
      "你吃饭了吗？记得好好吃饭哦",
      "想你想到发呆了...",
      "今天有什么有趣的事吗？",
      "看到好看的东西就想分享给你",
      "你最近忙不忙呀？",
      "突然好想抱抱你",
    ]) {
      expect(screen.queryByText(line)).toBeNull();
    }
  });

  it("does not say a quiet persona misses the user, and does not recommend them", () => {
    /**
     * A paused persona still sits in the list — it is the user's —
     * but the lobby must not push it forward, and it must not put
     * "想你了" on the card.
     *
     * The day's quote is drawn at random from the pool on this page.
     * The pool itself has to be free of 想你, or the assertion only
     * holds for the one quote the test happened to pin.
     */
    for (const quote of translate("zh", "lobby.quotes")) {
      expect(quote).not.toMatch(/想你/);
    }
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    personas = [
      makePersona({
        id: 4,
        name: "暂停的",
        presence: "quiet",
        lastUserMessageAt: weekAgo,
        lastChatAt: weekAgo,
      }),
    ];

    render(<Lobby />);

    expect(screen.queryAllByText(/想你/)).toEqual([]);
    expect(screen.queryByRole("heading", { name: "接着聊" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "继续对话" })).toBeNull();
    expect(screen.getAllByText("暂停的").length).toBeGreaterThan(0);
  });

  it("keeps a paused persona on the card and out of the quick row", () => {
    personas = [
      makePersona({ id: 1, name: "暂停的", presence: "quiet" }),
      makePersona({ id: 2, name: "可以的" }),
    ];

    render(<Lobby />);

    const row = screen.getByRole("heading", { name: "继续对话" }).closest("div.mb-8");
    expect(row?.textContent).toContain("可以的");
    expect(row?.textContent).not.toContain("暂停的");
    expect(screen.getAllByText("暂停的").length).toBeGreaterThan(0);
  });

  it("keeps a locked persona out of the recommendations but on the list (C8.4)", () => {
    /**
     * The list is allowed to show it — as a closed card. The
     * recommendations are not: "接着聊", the quick row and the
     * conversation starters all put a persona forward, and a locked one
     * has nothing to put forward.
     *
     * The fixture also carries the row-level `locked` flag the server
     * sends with the settings redacted, because that is the shape the
     * lobby actually receives.
     */
    const justNow = new Date().toISOString();
    personas = [
      makePersona({
        id: 1,
        name: "锁上的",
        locked: true,
        settings: { locked: true },
        lastUserMessageAt: justNow,
        lastChatAt: justNow,
      }),
      makePersona({ id: 2, name: "可以的" }),
    ];

    render(<Lobby />);

    const recommendation = screen.getByRole("heading", { name: "接着聊" }).closest("div.mb-8");
    expect(recommendation?.textContent).not.toContain("锁上的");
    expect(recommendation?.textContent).toContain("可以的");

    const quickRow = screen.getByRole("heading", { name: "继续对话" }).closest("div.mb-8");
    expect(quickRow?.textContent).toContain("可以的");
    expect(quickRow?.textContent).not.toContain("锁上的");

    const starters = screen.getByRole("heading", { name: "今日话题" }).closest("div.mb-8");
    expect(starters?.textContent).toContain("可以的");
    expect(starters?.textContent).not.toContain("锁上的");

    // The card is still in the directory, closed.
    expect(screen.getAllByText(translate("zh", "lobby.card.locked")).length).toBe(1);
  });

  it("uses the memorial wording for the create dialog's dates (C7.1)", async () => {
    /**
     * The edit page already says "认识的日子" / "离开的日子" for a
     * memorial persona. The create dialog kept "在一起的日期" /
     * "分开的日期" — the first thing a person making a memorial
     * persona sees was the wrong wording.
     *
     * The two keys are the ones PersonaEdit already uses; no new copy.
     */
    const user = userEvent.setup();
    personas = [makePersona()];
    render(<Lobby />);

    await user.click(screen.getByRole("button", { name: translate("zh", "lobby.directory.new") }));

    // Default wording first.
    expect(screen.getByText(translate("zh", "lobby.createDialog.togetherSince"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "personaEdit.togetherFromLabelMemorial"))).toBeNull();

    // Memorial on: the first date is when they met.
    await user.click(
      screen.getByRole("checkbox", {
        name: (name: string) => name.includes(translate("zh", "memorial.title")),
      }),
    );
    expect(screen.getByText(translate("zh", "personaEdit.togetherFromLabelMemorial"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "lobby.createDialog.togetherSince"))).toBeNull();

    // The end date, when shown, is the day they left.
    await user.click(
      screen.getByRole("checkbox", {
        name: (name: string) => name.includes(translate("zh", "lobby.createDialog.separated")),
      }),
    );
    expect(screen.getByText(translate("zh", "personaEdit.togetherToLabelMemorial"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "lobby.createDialog.separatedOn"))).toBeNull();

    // Memorial off: back to the ordinary wording.
    await user.click(
      screen.getByRole("checkbox", {
        name: (name: string) => name.includes(translate("zh", "memorial.title")),
      }),
    );
    expect(screen.getByText(translate("zh", "lobby.createDialog.togetherSince"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "personaEdit.togetherFromLabelMemorial"))).toBeNull();
    expect(screen.getByText(translate("zh", "lobby.createDialog.separatedOn"))).toBeInTheDocument();
  });

  it("picks up the persona the user spoke to most recently", () => {
    personas = [
      makePersona({
        id: 1,
        name: "更早的",
        lastUserMessageAt: "2026-03-01T00:00:00.000Z",
      }),
      makePersona({
        id: 2,
        name: "刚聊过的",
        lastUserMessageAt: "2026-03-10T00:00:00.000Z",
      }),
    ];

    render(<Lobby />);

    const heading = screen.getByRole("heading", { name: "接着聊" });
    const block = heading.closest("div.mb-8");
    expect(block?.textContent).toContain("刚聊过的");
    expect(block?.textContent).not.toContain("更早的");
  });

  it("says on the card how many days since the user last spoke", () => {
    /**
     * A fixed clock.
     *
     * The page reads the real clock, so a fixture computed from
     * `Date.now()` makes "3 days" only as true as the runner happens to
     * be. Pinning both ends makes the number mean the day it names.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-03-14T12:00:00Z"));
    try {
      personas = [
        makePersona({
          id: 3,
          name: "小A",
          lastUserMessageAt: "2026-03-11T12:00:00.000Z",
        }),
      ];

      render(<Lobby />);

      expect(screen.getByText("上次联系 3 天前")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not keep a streak, achievement badges, or a conversation ranking", () => {
    const today = zonedDateKey(new Date(), "Asia/Shanghai");
    dailyActivity = [
      { date: today, userCount: 2, count: 2 },
      { date: previousDateKey(today), userCount: 1, count: 1 },
    ];
    personas = [
      makePersona({ id: 1, name: "甲", chatCount: 10 }),
      makePersona({ id: 2, name: "乙", chatCount: 5 }),
    ];

    render(<Lobby />);

    expect(screen.queryByText(/连续对话/)).toBeNull();
    expect(screen.queryByText("成就徽章")).toBeNull();
    expect(screen.queryByText("对话排行")).toBeNull();
  });

  it("shows the group-chat door only once the experimental feature is on (C9.8)", () => {
    const label = translate("zh", "group.roomsTitle");

    // Off — the default — means there is no entry at all.
    authState.groupChat = false;
    const off = render(<Lobby />);
    expect(screen.queryByRole("button", { name: label })).toBeNull();
    off.unmount();

    // On: the entry is on the top bar, and it opens the rooms dialog.
    authState.groupChat = true;
    render(<Lobby />);
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });
});
