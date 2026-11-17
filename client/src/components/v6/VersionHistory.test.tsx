// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const restore = vi.fn();

let versions: Array<{
  id: number;
  reason: string;
  createdAt: string;
  overlap: number | null;
}> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    personaVersion: {
      list: {
        useQuery: () => ({ data: { versions }, refetch: vi.fn() }),
      },
      diff: {
        useQuery: () => ({ data: undefined }),
      },
      restore: {
        useMutation: () => ({ mutate: restore, isPending: false }),
      },
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

import VersionHistory from "./VersionHistory";
import { ConfirmProvider } from "@/components/ConfirmDialog";

describe("the persona version history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    versions = [];
  });

  it("asks before restoring, then calls the mutation", async () => {
    const user = userEvent.setup();
    versions = [
      {
        id: 10,
        reason: "edit",
        createdAt: "2026-01-01T12:00:00.000Z",
        overlap: 0.42,
      },
    ];
    render(
      <ConfirmProvider>
        <VersionHistory personaId={5} />
      </ConfirmProvider>,
    );
    expect(screen.getByText(translate("zh", "versionHistory.reasonEdit"))).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "versionHistory.overlap", { value: "0.42" })),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: translate("zh", "versionHistory.restore") }));
    expect(
      await screen.findByText(
        translate("zh", "versionHistory.restoreConfirm", { time: "2026-01-01 12:00" }),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: translate("zh", "common.confirm") }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith({ id: 5, versionId: 10 });
    });
  });
});
