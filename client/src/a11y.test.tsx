// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";
import { ThemeProvider } from "@/contexts/ThemeContext";

/**
 * Every button and every link a page draws has a name.
 *
 * A control with no accessible name is a control a screen-reader user
 * cannot find: the page is read out as "button, button, button". It is also
 * the easiest thing in the world to add and forget — an icon button with a
 * `title` (which is not a name for the accessibility tree on every platform)
 * or a plain `<img>` inside a button with no `alt`.
 *
 * The render list is the four main pages of the app — the lobby, the chat,
 * the settings page (its default profile tab and the 外观 tab this stage
 * added) and the persona profile — plus the surfaces that mount the rest of
 * this stage's new components: the data settings tab, the cost panel, the
 * first-run restore panel, the mailbox page, the interview page, the
 * described-statements section and a locked persona's card. Each is rendered
 * with the mocks its own test file uses.
 *
 *   Lobby:   OnThisDay, Milestones, MailboxEntry, PersonaUnreadNote, UndoToast
 *   Chat:    TimeBar, MemoryReview, ChoiceBubble, PendingReply, OutboundEntry,
 *            VoicesEntry, OutboundDrawer, WaitGauge, MeetDayNote,
 *            MeetCountdown, TheirSide, ScheduledSend, ClosedComposer,
 *            ReadMarker, UndoToast, BudgetNotice, PinnedBand, MarksPanel,
 *            ScenePanel, SceneRangeBanner, AfterChat
 *   Settings: SafetyTransparency, TtsNote, AccessibilitySettings (外观)
 *   Persona profile: EvidenceList, AddressHistoryView, DelayView, WaitGauge,
 *            TriggersView, ProsodyView, CallsView, PhotoTimeline,
 *            OurDictionary, FingerprintView, VoicesEntry, ReunionSummary,
 *            OralAccounts
 *
 * Every component this stage added and that can be mounted on its own is on
 * the list, so the "every control has a name" rule covers the whole stage.
 */

const nav = vi.hoisted(() => ({
  location: "/",
  params: {} as Record<string, string>,
  search: "",
}));

vi.mock("wouter", () => ({
  useLocation: () => [nav.location, vi.fn()],
  useParams: () => nav.params,
  useSearch: () => nav.search,
}));

const chatHistory: unknown[] = [];

const personaFixture = {
  id: 1,
  userId: 1,
  name: "小A",
  analysisStatus: "ready",
  emotionalState: "warm",
  graduationStatus: null,
  presence: "active",
  reachability: "reachable",
  relationshipEnded: false,
  isPinned: false,
  chatCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  relationshipDesc: "前女友",
  togetherFrom: "2021-06-15",
  togetherTo: null,
  timezone: null,
  personaData: {
    personality: "温柔",
    speakingStyle: "短句",
    catchphrases: ["嗯嗯"],
    microRules: [],
  },
  settings: {},
};

const profileFixture = {
  id: 1,
  name: "小A",
  username: "user",
  email: "user@example.com",
  role: "admin",
  createdAt: new Date("2024-01-01").toISOString(),
  lastSignedIn: new Date("2026-01-01").toISOString(),
  timezone: "Asia/Shanghai",
  graduationMode: "suggest",
  trajectoryAssessment: "auto",
  loginMethod: "password",
  addressStyle: "",
  boundaries: "",
};

const accountStatsFixture = {
  totalPersonas: 2,
  totalChats: 10,
  totalMessages: 100,
  totalFiles: 3,
  storageUsed: 2048,
};

const personaListFixture = [
  {
    id: 1,
    name: "小A",
    relationshipDesc: "前女友",
    analysisStatus: "ready",
    graduationStatus: "active",
    presence: "active",
    reachability: "reachable",
    relationshipEnded: false,
    isPinned: true,
    chatCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    settings: {},
  },
  {
    id: 2,
    name: "小B",
    relationshipDesc: "朋友",
    analysisStatus: "ready",
    graduationStatus: "active",
    presence: "active",
    reachability: "reachable",
    relationshipEnded: false,
    isPinned: false,
    chatCount: 1,
    createdAt: "2025-06-01T00:00:00.000Z",
    settings: {},
  },
];

/** A tree of `invalidate()` spies, for the pages that invalidate queries. */
function utilsSpy(): any {
  const util = vi.fn();
  const proxy: any = new Proxy(util, {
    get: (_target, property) => {
      if (property === "invalidate" || property === "refetch" || property === "reset" || property === "cancel") {
        return vi.fn();
      }
      return proxy;
    },
  });
  return proxy;
}

vi.mock("@/lib/trpc", () => ({
  trpc: {
    setup: { useQuery: () => ({ data: { hasLlmProvider: true, hasUserProvider: false } }) },
    /**
     * The OpenAI-compatible keys (C9.2).
     *
     * One key, so the row's own controls are drawn and checked too.
     */
    apiKey: {
      list: {
        useQuery: () => ({
          data: {
            keys: [{
              id: 3,
              name: "编辑器",
              prefix: "mk_abcdef12",
              scopes: ["chat"],
              lastUsedAt: null,
              revokedAt: null,
              createdAt: new Date("2026-03-01T00:00:00Z"),
            }],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      revoke: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    plugins: {
      // The loaded-plugins panel is mounted in the data tab (C9.7).
      list: {
        useQuery: () => ({
          data: { enabled: true, plugins: [] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    lock: {
      // The lobby's nav has the "lock now" button (C8.4).
      status: {
        useQuery: () => ({
          data: { hasPin: false, enabled: false, idleMinutes: 5, passkeys: [], locked: false },
          isError: false,
        }),
      },
      lockNow: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      verifyPin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      verifyPassword: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setPin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      updateSettings: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      disable: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      passkey: {
        registerOptions: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        registerVerify: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        remove: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
    persona: {
      list: {
        useQuery: () => ({
          data: personaListFixture,
          refetch: vi.fn(),
          isLoading: false,
          isError: false,
        }),
      },
      stats: { useQuery: () => ({ data: { totalPersonas: 2, totalChats: 10, todayChats: 1 } }) },
      get: {
        useQuery: () => ({
          data: personaFixture,
          isError: false,
          error: null,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      restore: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createSandbox: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      awaken: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      dailyActivity: { useQuery: () => ({ data: [] }) },
      recentActivity: { useQuery: () => ({ data: [] }) },
      checkGraduation: { useQuery: () => ({ data: { status: null } }) },
      getIntimacy: { useQuery: () => ({ data: null }) },
      graduationMode: { useQuery: () => ({ data: { mode: "suggest" } }) },
      updateSettings: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      graduate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      declineGraduation: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      exportManual: {
        useQuery: () => ({ refetch: async () => ({ data: { html: "<html></html>" } }) }),
      },
      reunionSummary: {
        useQuery: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
      },
      listDeleted: {
        useQuery: () => ({
          data: {
            personas: [
              {
                id: 9,
                name: "回收站里的",
                avatarUrl: null,
                relationshipDesc: null,
                chatCount: 3,
                deletedAt: "2026-03-01T10:00:00.000Z",
              },
            ],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      purge: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      evidence: {
        useQuery: () => ({
          data: {
            dimensions: {
              expression: [],
              trigger: [],
              conflict: [],
              care: [],
              memory: [],
              habit: [],
            },
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
    record: { onThisDay: { useQuery: () => ({ data: [] }) } },
    letter: {
      unreadCount: { useQuery: () => ({ data: { total: 0 } }) },
      todos: { useQuery: () => ({ data: { todos: [] } }) },
      inbox: {
        useQuery: () => ({
          data: {
            received: [
              {
                id: 1,
                personaId: 1,
                body: "写下来的话",
                status: "answered",
                mood: null,
                replyAt: null,
                repliedAt: "2026-03-02T10:00:00.000Z",
                replyText: "回信",
                readAt: null,
                createdAt: "2026-03-01T10:00:00.000Z",
                personaName: "小A",
              },
            ],
            waiting: [
              {
                id: 2,
                personaId: 1,
                body: "还没有回音的话",
                status: "waiting",
                mood: null,
                replyAt: "2026-03-05T10:00:00.000Z",
                repliedAt: null,
                replyText: null,
                readAt: null,
                createdAt: "2026-03-02T10:00:00.000Z",
                personaName: "小A",
              },
            ],
            kept: [
              {
                id: 3,
                personaId: 1,
                body: "写了没寄的",
                status: "private",
                mood: null,
                replyAt: null,
                repliedAt: null,
                replyText: null,
                readAt: null,
                createdAt: "2026-03-03T10:00:00.000Z",
                personaName: "小A",
              },
            ],
            capsules: [
              {
                id: 4,
                personaId: 1,
                kind: "capsule",
                body: "到日子的胶囊",
                dueAt: "2026-03-01T10:00:00.000Z",
                status: "delivered",
                openedAt: null,
                personaName: "小A",
              },
            ],
            upcoming: [
              {
                id: 5,
                personaId: 1,
                kind: "capsule",
                body: "还没到日子",
                dueAt: "2999-01-01T10:00:00.000Z",
                status: "scheduled",
                openedAt: null,
                personaName: "小A",
              },
            ],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      markRead: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
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
      getProfile: {
        useQuery: () => ({ data: profileFixture, refetch: vi.fn(), isError: false }),
      },
      getAccountStats: { useQuery: () => ({ data: accountStatsFixture }) },
      updateProfile: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      changePassword: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateGraduationMode: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateTrajectoryAssessment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setLocale: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      deleteAccount: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      exportCounselorSummary: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      // The group-chat switch in the profile tab (C9.8).
      updateFeatures: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    usage: {
      budget: { useQuery: () => ({ data: { over: false } }) },
      summary: {
        useQuery: () => ({
          data: {
            totals: { calls: 4, promptTokens: 700, completionTokens: 240, estimatedCalls: 1, costMicros: null },
            byPurpose: [
              { purpose: "reply", promptTokens: 600, completionTokens: 200, calls: 3, estimatedCalls: 1, costMicros: 0 },
              { purpose: "rerank", promptTokens: 100, completionTokens: 40, calls: 1, estimatedCalls: 0, costMicros: 0 },
            ],
            byPersona: [],
            byDay: [],
            budget: { budget: null, over: false, tokens: 940, costMicros: 0, monthStart: "" },
            prices: [],
            currency: null,
            rerank: { calls: 1, estimatedCalls: 0, costMicros: 0, promptTokens: 100, completionTokens: 40 },
            lastDistill: null,
          },
          isLoading: false,
          isError: false,
        }),
      },
      setBudget: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setPrice: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    llmConfig: {
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
    },
    encryption: {
      status: {
        useQuery: () => ({
          data: {
            enabled: false,
            unlocked: false,
            hasRecoveryCode: false,
            hasFullBackup: false,
            migrating: false,
            migration: null,
            migratedAt: null,
          },
          isLoading: false,
          isError: false,
        }),
      },
      enable: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      disable: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      unlock: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      lock: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      recover: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    system: {
      diagnose: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    backup: {
      getSettings: {
        useQuery: () => ({
          data: {
            enabled: false,
            frequency: "daily",
            hasPassphrase: false,
            hasTargetPassword: false,
            hasTargetSecretAccessKey: false,
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      updateSettings: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    email: {
      getConfig: {
        useQuery: () => ({
          data: {
            configured: false,
            host: null,
            port: null,
            secure: true,
            user: null,
            from: null,
            to: null,
            subjectWithName: false,
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      saveConfig: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      test: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    push: {
      publicKey: {
        useQuery: () => ({ data: undefined, isError: false, isLoading: false, refetch: vi.fn() }),
      },
      list: {
        useQuery: () => ({ data: [], isError: false, isLoading: false, refetch: vi.fn() }),
      },
      subscribe: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      unsubscribe: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setPreview: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      test: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    safety: {
      events: {
        useQuery: () => ({
          data: { events: [] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      assessments: {
        useQuery: () => ({ data: { assessments: [] }, isLoading: false, isError: false }),
      },
      resolveEvent: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    chat: {
      markRead: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getHistory: {
        useQuery: () => ({ data: chatHistory, isError: false, refetch: vi.fn() }),
      },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateMessage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      deleteMessage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      restoreMessage: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
      },
      export: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      tts: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      exportAll: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      voices: { useQuery: () => ({ data: { voices: [] } }) },
      search: { useQuery: () => ({ data: [] }) },
      pendingReply: {
        useQuery: () => ({ data: null, isError: false, isLoading: false, refetch: vi.fn() }),
      },
      replyNow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scene: {
      list: { useQuery: () => ({ data: [] }) },
      activate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      deactivate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    fidelity: { mark: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    checkin: {
      pending: { useQuery: () => ({ data: { pending: null, worse: false } }) },
      answer: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      acknowledgeWorse: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      markPrompted: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    outbound: {
      list: { useQuery: () => ({ data: { letters: [] }, refetch: vi.fn() }) },
      addFromMessage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    memory: {
      list: { useQuery: () => ({ data: { items: [], total: 0 } }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      adjudicate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      autoExtract: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    emotion: {
      getReport: { useQuery: () => ({ data: undefined, isError: false, isLoading: false }) },
    },
    relationship: {
      list: { useQuery: () => ({ data: { events: [] } }) },
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    ldr: {
      status: { useQuery: () => ({ data: { enabled: true } }) },
      weather: { useQuery: () => ({ data: null }) },
    },
    scheduled: {
      list: { useQuery: () => ({ data: { items: [] }, isError: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      markOpened: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    mark: {
      list: { useQuery: () => ({ data: { marks: [], maxPins: 3 } }) },
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    lexicon: { save: { useMutation: () => ({ mutate: vi.fn() }) } },
    style: {
      get: {
        useQuery: () => ({
          data: { profile: null },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
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
    interview: {
      next: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      finish: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      transcribe: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
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
    channel: {
      // The bot channels panel is mounted in the channels tab (C9.1).
      list: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }) },
      getStatus: {
        useQuery: () => ({
          data: { channel: "telegram", connected: false, status: "stopped", detail: { bindCode: "123456" } },
          isError: false,
          refetch: vi.fn(),
        }),
      },
      getChannelDefault: { useQuery: () => ({ data: { personaId: 1 }, refetch: vi.fn() }) },
      setBotCredentials: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      start: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      stop: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setChannelDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    group: {
      // The group chat page and the lobby's rooms dialog (C9.8).
      list: {
        useQuery: () => ({
          data: {
            rooms: [
              {
                id: 3,
                name: "周末的群",
                createdAt: "2026-03-01T10:00:00.000Z",
                members: [
                  { personaId: 1, name: "小A", avatarUrl: null, hasGroupData: true, available: true },
                  { personaId: 2, name: "小B", avatarUrl: null, hasGroupData: false, available: false },
                ],
                lastMessage: null,
              },
            ],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      history: {
        useQuery: () => ({
          data: {
            room: {
              id: 3,
              name: "周末的群",
              members: [
                { personaId: 1, name: "小A", avatarUrl: null, hasGroupData: true, available: true },
                { personaId: 2, name: "小B", avatarUrl: null, hasGroupData: false, available: false },
              ],
            },
            messages: [
              {
                id: 1,
                role: "user",
                personaId: null,
                personaName: null,
                content: "在吗",
                createdAt: "2026-03-01T10:00:00.000Z",
              },
              {
                id: 2,
                role: "assistant",
                personaId: 1,
                personaName: "小A",
                content: "在的",
                createdAt: "2026-03-01T10:01:00.000Z",
              },
            ],
            nextCursor: null,
          },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      send: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => utilsSpy(),
  },
}));

vi.mock("@/lib/chat-stream", () => ({
  streamChat: vi.fn(),
  isStreamingUnsupported: () => false,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "测试",
      name: "测试",
      timezone: "Asia/Shanghai",
      // The lobby's group-chat door is on the render list (C9.8).
      features: { groupChat: true },
    },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      translate("zh", key as never, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/pwa", () => ({
  isInstallAvailable: () => false,
  onInstallAvailabilityChange: () => () => {},
  promptInstall: vi.fn(),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => async () => true,
  ConfirmProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("@/components/MoodCheckIn", () => ({ default: () => null }));

vi.mock("@/components/FidelityPanel", () => ({ default: () => null }));

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: unknown }) => children as never,
  defaultRehypePlugins: { harden: {}, raw: {}, katex: {} },
}));

import Lobby from "./pages/Lobby";
import ShareInbox from "./pages/ShareInbox";
import { SHARE_INBOX_CACHE } from "./lib/share-inbox";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";
import PersonaProfile from "./pages/PersonaProfile";
import { DataManagementTab } from "./pages/Settings";
import InterviewView from "./components/v6/InterviewView";
import DescribedStatements from "./components/v6/DescribedStatements";
import DescribedFidelityNote from "./components/v6/DescribedFidelityNote";
import LockedPersonaCard from "./components/v6/LockedPersonaCard";
import UsagePanel from "./components/v6/UsagePanel";
import RestoreBackupPanel from "./components/v6/RestoreBackupPanel";
import ApiKeys from "./components/v6/ApiKeys";
import PersonaBundle from "./components/v6/PersonaBundle";
import BotChannels from "./components/v6/BotChannels";
import Letters from "./pages/Letters";
import Group from "./pages/Group";
import { GroupRooms } from "./components/v6/GroupRooms";
import GroupChatSetting from "./components/v6/GroupChatSetting";

/**
 * Renders a page inside the real theme provider (the accessibility panel
 * reads and writes it) and checks every control's accessible name.
 */
function renderPage(node: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light" switchable>
      {node}
    </ThemeProvider>,
  );
}

/**
 * The page actually drew something.
 *
 * Every check below is "every control has a name" — which is trivially true
 * for a page that drew no controls. The count makes the render list mean
 * what it says: the page's own content, its navigation and its panels.
 */
function drawnControls(): number {
  return screen.queryAllByRole("button").length + screen.queryAllByRole("link").length;
}

/** The controls whose accessible name is empty, in a readable shape. */
function unnamedControls(): string[] {
  const gaps: string[] = [];
  for (const role of ["button", "link"] as const) {
    for (const element of screen.queryAllByRole(role)) {
      try {
        expect(element).toHaveAccessibleName();
      } catch {
        const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        const html = element.outerHTML.replace(/\s+/g, " ").slice(0, 180);
        gaps.push(`<${role}> text="${text}" ${html}`);
      }
    }
  }
  return gaps;
}

describe("every control has a name", () => {
  beforeEach(() => {
    localStorage.clear();
    chatHistory.length = 0;
    nav.location = "/";
    nav.params = {};
    nav.search = "";
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("in the lobby", () => {
    nav.location = "/";
    renderPage(<Lobby />);
    expect(drawnControls()).toBeGreaterThan(8);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the chat", () => {
    nav.location = "/chat/1";
    nav.params = { id: "1" };
    renderPage(<Chat />);
    expect(drawnControls()).toBeGreaterThan(5);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the settings page", () => {
    nav.location = "/settings";
    nav.search = "";
    renderPage(<Settings />);
    // The back control, the profile form's four buttons, and the tab list
    // (whose controls have the tab role, so they are not counted here).
    expect(drawnControls()).toBeGreaterThan(3);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the appearance panel", () => {
    // The tab this stage added. It mounts AccessibilitySettings — the one
    // new component of the stage — so it is on the render list.
    nav.location = "/settings";
    nav.search = "?tab=appearance";
    renderPage(<Settings />);
    expect(drawnControls()).toBeGreaterThan(3);
    // The new panel is really on the screen.
    expect(screen.getByTestId("accessibility-settings")).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
  });

  it("in the persona profile", () => {
    nav.location = "/persona/1";
    nav.params = { id: "1" };
    renderPage(<PersonaProfile />);
    expect(drawnControls()).toBeGreaterThan(5);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the shared-files page", async () => {
    // The page the OS share sheet opens (C8.8). The Cache API is faked
    // with one waiting file, so the page draws its import control.
    const store = new Map<string, Response>();
    store.set(
      "http://localhost:3000/share-target-inbox/1-0",
      new Response("a,b", {
        headers: { "content-type": "text/csv", "x-mirrai-filename": "chat.csv" },
      }),
    );
    const cache = {
      put: async () => undefined,
      match: async (key: string | Request) =>
        store.get(typeof key === "string" ? key : key.url),
      keys: async () => Array.from(store.keys()).map((url) => new Request(url)),
      delete: async () => true,
      add: async () => undefined,
    };
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {
        open: async () => cache,
        keys: async () => [SHARE_INBOX_CACHE],
        delete: async () => true,
        match: async () => undefined,
      },
    });
    nav.location = "/share-inbox";
    renderPage(<ShareInbox />);
    expect(await screen.findByText("chat.csv")).toBeInTheDocument();
    expect(drawnControls()).toBeGreaterThan(0);
    expect(unnamedControls()).toEqual([]);
  });

  /**
   * The components added later in the stage (C1.8, C8.3–C8.5).
   *
   * They are mounted on surfaces the original list did not render — the
   * data settings tab, the interview page, the described-statements
   * section and a locked persona's card. Rendering the surface they live
   * on is what puts them through the same "every control has a name"
   * rule.
   */
  it("in the data settings panel", () => {
    renderPage(<DataManagementTab />);
    expect(drawnControls()).toBeGreaterThan(3);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the interview page", () => {
    renderPage(<InterviewView initialName="小满" />);
    // The opening screen is the intro and one "start" control; the rest
    // of the conversation is the same component after it.
    expect(drawnControls()).toBeGreaterThan(0);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the described statements and the fidelity note", () => {
    render(
      <ThemeProvider defaultTheme="light" switchable>
        <>
          <DescribedStatements
            name="小满"
            ownName="阿树"
            statements={[
              {
                text: "生气时先沉默。",
                source: "described",
                quote: "生气的时候一句话都不说",
                field: "personality",
                teller: "琪琪",
              },
            ]}
          />
          <DescribedFidelityNote name="小满" />
        </>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("described-statements")).toBeInTheDocument();
    // These two components have no buttons at all, so a zero-control
    // count proves nothing on its own: the test says the text is really
    // on the page, then that there is no unnamed control anywhere.
    expect(screen.getByText(/生气时先沉默/)).toBeInTheDocument();
    expect(screen.getByText(/生气的时候一句话都不说/)).toBeInTheDocument();
    expect(screen.getByText(/琪琪/)).toBeInTheDocument();
    expect(drawnControls()).toBe(0);
    expect(unnamedControls()).toEqual([]);
  });

  it("on a locked persona's card", () => {
    renderPage(<LockedPersonaCard personaId={7} />);
    expect(drawnControls()).toBeGreaterThan(0);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the API keys panel", () => {
    renderPage(<ApiKeys />);
    // Create and the row's revoke. The name field and the two scope boxes
    // are inputs; this check is about buttons and links.
    expect(drawnControls()).toBeGreaterThan(1);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the bot channels panel", () => {
    renderPage(<BotChannels />);
    // Save, start and stop per channel; the inputs are not buttons.
    expect(drawnControls()).toBeGreaterThan(3);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the persona bundle panel", () => {
    renderPage(<PersonaBundle />);
    // Export and import; the checkboxes and the file picker are inputs.
    expect(drawnControls()).toBeGreaterThan(1);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the cost panel", () => {
    renderPage(<UsagePanel />);
    // The three ranges, the two saves, and the price line.
    expect(drawnControls()).toBeGreaterThan(3);
    expect(unnamedControls()).toEqual([]);
  });

  it("on the first-run restore panel", async () => {
    /**
     * The panel asks the server whether a restore is possible before it
     * draws anything. Answer "yes" so the form (and its controls) is on
     * the screen; the fetch is put back afterwards.
     */
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ available: true }),
    })));
    try {
      renderPage(<RestoreBackupPanel />);
      expect(await screen.findByTestId("restore-backup-panel")).toBeInTheDocument();
      expect(drawnControls()).toBeGreaterThan(0);
      expect(unnamedControls()).toEqual([]);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("in the mailbox page", () => {
    renderPage(<Letters />);
    // The back control and the rows' own actions.
    expect(drawnControls()).toBeGreaterThan(2);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the group page", () => {
    nav.location = "/group/3";
    nav.params = { id: "3" };
    renderPage(<Group />);
    // The back control, the dissolve button and the send button; the
    // input and the checkboxes are not buttons.
    expect(drawnControls()).toBeGreaterThan(2);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the group rooms dialog", () => {
    renderPage(<GroupRooms open onOpenChange={() => {}} onOpenRoom={() => {}} />);
    // Open, dissolve, cancel, create and the dialog's own close.
    expect(drawnControls()).toBeGreaterThan(3);
    expect(unnamedControls()).toEqual([]);
  });

  it("in the group-chat setting", () => {
    renderPage(<GroupChatSetting />);
    // The switch has its own role, so the button check above would not
    // see it; it is named by the visible label.
    expect(screen.getByRole("switch")).toHaveAccessibleName(
      translate("zh", "settings.profile.groupChatSwitch"),
    );
    expect(unnamedControls()).toEqual([]);
  });

});
