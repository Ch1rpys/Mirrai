// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const deleteFile = vi.fn();
const deleteSource = vi.fn();

let rows: Array<{
  source: string;
  fileId: number | null;
  name: string;
  format: string;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  status: string;
}> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    record: {
      sources: {
        useQuery: () => ({ data: rows, refetch: vi.fn() }),
      },
      deleteSource: {
        useMutation: () => ({ mutate: deleteSource, isPending: false }),
      },
    },
    file: {
      delete: {
        useMutation: () => ({ mutate: deleteFile, isPending: false }),
      },
    },
    useUtils: () => ({
      persona: { getSettings: { invalidate: vi.fn() } },
    }),
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

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" } }),
}));

import RecordSources from "./RecordSources";
import { ConfirmProvider } from "@/components/ConfirmDialog";

describe("the record sources list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
  });

  it("renders nothing when there are no sources", () => {
    const { container } = render(
      <ConfirmProvider>
        <RecordSources personaId={5} />
      </ConfirmProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a source and deletes it after confirmation", async () => {
    const user = userEvent.setup();
    rows = [
      {
        source: "wechat_export",
        fileId: 11,
        name: "chat.txt",
        format: "wechat-txt-2line",
        count: 13,
        firstAt: "2022-03-01T12:00:00.000Z",
        lastAt: "2022-03-02T12:00:00.000Z",
        status: "done",
      },
    ];
    render(
      <ConfirmProvider>
        <RecordSources personaId={5} />
      </ConfirmProvider>,
    );
    expect(screen.getByText("chat.txt")).toBeInTheDocument();
    expect(screen.getByText("wechat-txt-2line")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "upload.recordSourceCount", { count: 13 }))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: translate("zh", "common.delete") }));
    expect(
      await screen.findByText(
        translate("zh", "upload.deleteSourceConfirm", { name: "chat.txt", count: 13 }),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: translate("zh", "common.confirm") }));
    await waitFor(() => {
      expect(deleteFile).toHaveBeenCalledWith({ fileId: 11 });
    });
    expect(deleteSource).not.toHaveBeenCalled();
  });
});
