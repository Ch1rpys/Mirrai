// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The portrait.
 *
 * The page is what the app thinks this person is. Two things were added
 * to it and both are about honesty:
 *
 *   the rules the user confirmed are shown as *the user's* decisions,
 *   and the candidates they never confirmed are not shown at all —
 *   presenting a guess as a decision is the one thing this page must
 *   not do.
 */
let persona: any;
/** The memories the server sends, and how many there are in all. */
let memoryItems: any[] = [];
let memoryTotal = 0;
/** Whether the query is still on its way. */
let personaLoading = false;
/** Whether the query failed. */
let personaFailed = false;
let evidenceDimensions: Record<string, unknown[]> = {
  expression: [],
  trigger: [],
  conflict: [],
  care: [],
  memory: [],
  habit: [],
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    lexicon: { save: { useMutation: () => ({ mutate: vi.fn() }) } },
    persona: {
      get: {
        useQuery: () => ({
          data: persona,
          isLoading: personaLoading,
          isError: personaFailed,
          error: null,
          refetch: () => {},
        }),
      },
      exportManual: {
        useQuery: () => ({ refetch: async () => ({ data: { html: "<html></html>" } }) }),
      },
      reunionSummary: {
        useQuery: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      updateSettings: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      purgeForConsent: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          isError: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      evidence: {
        useQuery: () => ({
          data: { dimensions: evidenceDimensions },
          isLoading: false,
          isError: false,
        }),
      },
    },
    consent: {
      status: {
        useQuery: () => ({
          data: { consent: "not_asked", link: null },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      setStatus: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      exportPage: { useQuery: () => ({ refetch: vi.fn(), isFetching: false }) },
      createLink: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    style: {
      get: {
        useQuery: () => ({ data: { profile: null }, isLoading: false, isError: false, refetch: vi.fn() }),
      },
    },
    media: {
      measureProsody: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      listPhotos: {
        useQuery: () => ({
          data: { photos: [], total: 0 },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    useUtils: () => ({
      persona: {
        get: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
        purgeForConsent: { invalidate: vi.fn() },
      },
    }),
    memory: {
      list: { useQuery: () => ({ data: { items: memoryItems, total: memoryTotal } }) },
      adjudicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    interview: {
      fromOral: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    oral: {
      list: {
        useQuery: () => ({
          data: { isOwner: true, ownerName: "", accounts: [], conflicts: [] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      extract: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      transcribe: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    relationship: {
      list: { useQuery: () => ({ data: { events: [] } }) },
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1", vi.fn()],
}));

/** The language the page is read in. */
let locale: "zh" | "en" = "zh";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate(locale, key, params),
    locale,
    localeName: locale === "en" ? "English" : "中文",
    setLocale: () => {},
  }),
}));

// The panel brings its own data access with it.
vi.mock("@/components/FidelityPanel", () => ({
  default: () => <div data-testid="fidelity-panel" />,
}));

import PersonaProfile from "./PersonaProfile";

describe("the portrait", () => {
  beforeEach(() => {
    locale = "zh";
    memoryItems = [];
    memoryTotal = 0;
    evidenceDimensions = {
      expression: [],
      trigger: [],
      conflict: [],
      care: [],
      memory: [],
      habit: [],
    };
  });

  it("says when the memories are cut short", () => {
    /**
     * The server says how many there are — and this page did not say
     * anything, so a persona with four hundred memories showed two
     * hundred of them and the page said "here are the milestones".
     */
    memoryItems = [
      { id: 1, title: "第一次见面", category: "milestone", date: "2024-03-14" },
    ];
    memoryTotal = 400;

    render(<PersonaProfile />);

    expect(
      screen.getByText(translate("zh", "chat.memory.capped", { shown: 1, total: 400 })),
    ).toBeInTheDocument();
  });

  it("does not print a Chinese identifier in the English interface", () => {
    /**
     * What is stored is a Chinese *identifier* — "安全型", "肯定的言辞" —
     * and it was printed as it was. So an English user read
     * "肯定的言辞" under "Love language", while the same persona's
     * lobby card read "Words of affirmation".
     */
    locale = "en";
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      analysisStatus: "ready",
      emotionalState: "warm",
      personaData: {
        attachmentStyle: "安全型",
        loveLanguage: "肯定的言辞",
        personality: "温柔",
      },
    };

    render(<PersonaProfile />);

    expect(screen.getByText("Words of affirmation")).toBeInTheDocument();
    expect(screen.getByText("Secure")).toBeInTheDocument();
    expect(screen.queryByText("肯定的言辞")).toBeNull();
    expect(screen.queryByText("安全型")).toBeNull();
  });

  it("hides the call entry until the call layer is on", () => {
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      analysisStatus: "ready",
      emotionalState: "warm",
      personaData: {},
      settings: {},
    };
    const first = render(<PersonaProfile />);
    expect(
      screen.queryByText(translate("zh", "profile.callEntry", { name: "小A" })),
    ).toBeNull();
    first.unmount();

    persona = {
      ...persona,
      settings: { layers: { callMode: true } },
    };
    render(<PersonaProfile />);
    expect(
      screen.getByText(translate("zh", "profile.callEntry", { name: "小A" })),
    ).toBeInTheDocument();
  });

  it("does not spin for ever when the persona cannot be read", () => {
    // The sign-in request failed, so the persona query stayed disabled:
    // no persona, no error, and the loader the page showed for ever.
    // There has to be a way back.
    persona = undefined as any;
    personaLoading = false;
    personaFailed = false;

    render(<PersonaProfile />);

    expect(screen.getByText(translate("zh", "common.retry"))).toBeInTheDocument();
  });


  beforeEach(() => {
    personaLoading = false;
    personaFailed = false;
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      relationshipDesc: "前女友",
      togetherFrom: "2021-06-15",
      togetherTo: null,
      timezone: null,
      personaData: {
        personality: "温柔",
        speakingStyle: "短句",
        catchphrases: ["嗯嗯"],
        microRules: [
          {
            id: "r1",
            trigger: ["随便你"],
            meaning: "她真的生气了",
            rendering: "更短、更冷",
            confidence: 1,
            source: "manual",
            verified: true,
            evidence: [],
          },
          {
            id: "r2",
            trigger: ["嗯"],
            meaning: "在听",
            rendering: "回一个嗯",
            confidence: 0.6,
            source: "auto",
            verified: false,
            evidence: [],
          },
        ],
      },
    };
  });

  it("shows the rules the user confirmed", () => {
    render(<PersonaProfile />);
    expect(screen.getByText(translate("zh", "profile.rules"))).toBeInTheDocument();
    expect(screen.getByText(/她真的生气了/)).toBeInTheDocument();
  });

  it("does not show the candidates the user never confirmed", () => {
    render(<PersonaProfile />);
    // The unconfirmed rule's meaning must not appear on the page.
    expect(screen.queryByText(/在听/)).toBeNull();
  });

  it("shows the ruler", () => {
    render(<PersonaProfile />);
    expect(screen.getByTestId("fidelity-panel")).toBeInTheDocument();
  });

  it("shows the counted addresses", () => {
    persona.styleProfile = {
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "1:1",
      addressHistory: [
        {
          form: "树树",
          direction: "them_to_me",
          total: 10,
          byQuarter: { "2022Q1": 10 },
          byState: { warm: 10 },
        },
      ],
    };
    render(<PersonaProfile />);
    expect(screen.getByText(translate("zh", "profile.address"))).toBeInTheDocument();
    expect(screen.getByText("树树")).toBeInTheDocument();
  });

  it("has no rules section when there are no rules", () => {
    persona.personaData.microRules = [];
    render(<PersonaProfile />);
    expect(screen.queryByText(translate("zh", "profile.rules"))).toBeNull();
  });

  it("always marks attachment style as inferred", () => {
    persona.personaData = { attachmentStyle: "安全型" };
    evidenceDimensions.habit = [{
      claim: "短句",
      periodId: null,
      quotes: [{ recordId: 7, at: null, speaker: "小满", text: "在的呀" }],
    }];
    render(<PersonaProfile />);
    expect(screen.getByText(translate("zh", "evidence.inferred"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: translate("zh", "evidence.toggle", { count: 1 }) }),
    ).toBeNull();
  });

  it("marks every layer as inferred when there are no cards", () => {
    persona.personaData = {
      personality: "温柔",
      speakingStyle: "短句",
      catchphrases: ["嗯嗯"],
      attachmentStyle: "安全型",
      loveLanguage: "肯定的言辞",
      conflictStyle: "先冷静",
      memories: "一起看过海",
      touchingMoments: "记得细节",
    };
    render(<PersonaProfile />);
    expect(screen.getAllByText(translate("zh", "evidence.inferred"))).toHaveLength(8);
  });

  it("drops the coming-back entry once it has been put away (C5.4)", () => {
    persona.settings = {
      lastReunion: {
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-03-01T00:00:00.000Z",
        dismissed: true,
      },
    };
    render(<PersonaProfile />);
    expect(screen.queryByText(translate("zh", "reunion.title"))).toBeNull();
  });

  it("keeps the coming-back entry while it has not been put away (C5.4)", () => {
    persona.settings = {
      lastReunion: { from: "2026-02-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" },
    };
    render(<PersonaProfile />);
    expect(screen.getByText(translate("zh", "reunion.title"))).toBeInTheDocument();
  });
});
