// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The data tab.
 *
 * It is the one place where the app says what it is about to destroy —
 * so the numbers in it have to be true. A request that failed says
 * nothing about what the user has.
 */

const accountStats: { data: any; isError: boolean } = { data: undefined, isError: false };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    lock: {
      // The app lock's settings are mounted in this tab (C8.4).
      status: {
        useQuery: () => ({
          data: { hasPin: false, enabled: false, idleMinutes: 5, passkeys: [] },
          isError: false,
        }),
      },
      setPin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      updateSettings: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      disable: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      passkey: {
        registerOptions: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        registerVerify: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        remove: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
    encryption: {
      // The encrypted storage panel is mounted in this tab (C8.5); the
      // tests here are about the deletion dialog, not about it.
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
      // The one-click diagnosis panel is mounted in this tab (C8.12); the
      // tests here are about the deletion dialog, not about it.
      diagnose: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({
      persona: {
        listDeleted: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
      },
    }),
    user: {
      getAccountStats: { useQuery: () => accountStats },
      deleteAccount: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      exportCounselorSummary: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    chat: {
      exportAll: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    // The complete backup panel is mounted in this tab (C8.3); the tests
    // here are about the deletion dialog, not about it.
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
    persona: {
      // The persona bundle panel is mounted in this tab (C9.5); these
      // tests are about the deletion dialog, not about it.
      list: {
        useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
      },
      listDeleted: {
        useQuery: () => ({
          data: { personas: [] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      restore: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      purge: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
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
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true, loading: false, logout: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/pwa", () => ({
  isInstallAvailable: () => false,
  onInstallAvailabilityChange: () => () => {},
  promptInstall: vi.fn(),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import { DataManagementTab } from "./Settings";
import { ConfirmProvider } from "@/components/ConfirmDialog";

describe("the data tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountStats.data = undefined;
    accountStats.isError = false;
  });

  it("does not say the user has nothing when the counts could not be read", () => {
    /**
     * The one dialog that must not lie about what is about to be
     * destroyed said "0 personas, 0 messages, 0 files" when the
     * request failed.
     */
    accountStats.isError = true;

    render(
      <ConfirmProvider>
        <DataManagementTab />
      </ConfirmProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: translate("zh", "settings.data.deleteTitle") }));

    const dialog = screen.getByText(translate("zh", "settings.data.confirmBodyUnknown"));
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "settings.data.confirmBody", {
      personas: 0, messages: 0, files: 0,
    }))).toBeNull();
  });

  it("says what is about to be destroyed", () => {
    accountStats.data = { totalPersonas: 3, totalMessages: 120, totalFiles: 2 };

    render(
      <ConfirmProvider>
        <DataManagementTab />
      </ConfirmProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: translate("zh", "settings.data.deleteTitle") }));

    expect(
      screen.getByText(translate("zh", "settings.data.confirmBody", {
        personas: 3, messages: 120, files: 2,
      })),
    ).toBeInTheDocument();
  });
});
