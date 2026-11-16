// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const confirm = vi.fn();
const apply = vi.fn();
const cancel = vi.fn();
const refetch = vi.fn();
const navigate = vi.fn();

let status: {
  fileId: number;
  personaId: number;
  parseStatus: string | null;
  parseReport: Record<string, unknown> | null;
  originalName: string;
  fileType: string;
  fileSize: number;
} | undefined;
let preview: {
  status: string;
  total: number;
  records: Array<{ timestamp: string | null; speaker: string; content: string; kind: string; lineNo: number }>;
  report: Record<string, unknown>;
} | undefined;
let statusError: { message: string } | null = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    import: {
      status: {
        useQuery: () => ({ data: status, error: statusError, refetch }),
      },
      formats: {
        useQuery: () => ({
          data: [
            { id: "generic-line", label: "一行一条" },
            { id: "wechat-txt-2line", label: "微信两行" },
            { id: "column-map", label: "按列对应" },
          ],
        }),
      },
      preview: {
        useQuery: () => ({ data: preview }),
      },
      confirm: {
        useMutation: () => ({ mutateAsync: confirm, isPending: false }),
      },
      resume: {
        useMutation: () => ({ mutateAsync: apply, mutate: apply, isPending: false }),
      },
      cancel: {
        useMutation: () => ({ mutate: cancel, isPending: false }),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/upload/1", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import ImportWizard from "./ImportWizard";

function fileStatus(parseStatus: string, parseReport: Record<string, unknown> | null = null) {
  return {
    fileId: 11,
    personaId: 5,
    parseStatus,
    parseReport,
    originalName: "chat.txt",
    fileType: "chat_txt",
    fileSize: 120,
  };
}

describe("the import wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusError = null;
    preview = undefined;
    status = fileStatus("detecting", { progress: 12, written: 4 });
    confirm.mockResolvedValue({ status: "done", written: 2 });
    apply.mockResolvedValue({ status: "needs_roles", written: 0 });
  });

  it("shows a progress bar while detecting", () => {
    render(<ImportWizard fileId={11} personaName="小满" timezone="Asia/Shanghai" />);
    expect(screen.getByText(translate("zh", "importWizard.detecting"))).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText(translate("zh", "importWizard.progress", { written: 4 }))).toBeTruthy();
  });

  it("offers a format list when the file was not recognised", () => {
    status = fileStatus("needs_format", { rawTable: { headers: ["a", "b", "c"], rows: [["1", "2", "3"]] } });
    render(<ImportWizard fileId={11} personaName="小满" timezone="Asia/Shanghai" />);
    expect(screen.getByText(translate("zh", "importWizard.unknownFormat"))).toBeTruthy();
    expect(screen.getByLabelText(translate("zh", "importWizard.formatLabel"))).toBeTruthy();
    expect(screen.getByRole("button", { name: translate("zh", "importWizard.columnMap") })).toBeTruthy();
  });

  it("disables continue until both sides are named, then confirms them", async () => {
    const user = userEvent.setup();
    status = fileStatus("needs_roles", {
      format: "generic-line",
      speakers: [
        { name: "小满", count: 3 },
        { name: "阿树", count: 2 },
      ],
    });
    preview = {
      status: "ok",
      total: 5,
      records: [
        { timestamp: "2022-03-01T12:00:00.000Z", speaker: "小满", content: "在吗", kind: "text", lineNo: 1 },
      ],
      report: { format: "generic-line", roleCounts: { user: 2, assistant: 3 } },
    };
    render(<ImportWizard fileId={11} personaName="小满" timezone="Asia/Shanghai" />);

    const continueButton = screen.getByRole("button", { name: translate("zh", "importWizard.continue") });
    expect(continueButton).toBeDisabled();

    const them = screen.getByRole("group", { name: /小满/ });
    const me = screen.getByRole("group", { name: /阿树/ });
    await user.click(within(them).getByRole("radio", { name: translate("zh", "importWizard.role.them") }));
    expect(continueButton).toBeDisabled();
    await user.click(within(me).getByRole("radio", { name: translate("zh", "importWizard.role.me") }));

    expect(continueButton).not.toBeDisabled();
    expect(screen.getByText(translate("zh", "importWizard.previewTitle"))).toBeTruthy();
    await user.click(continueButton);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      fileId: 11,
      format: "generic-line",
      me: ["阿树"],
      them: ["小满"],
    });
  });

  it("says how many rows were added when the import is done", () => {
    status = fileStatus("done", {
      written: 12,
      existing: 3,
      roleCounts: { user: 5, assistant: 7 },
    });
    render(<ImportWizard fileId={11} personaName="小满" timezone="Asia/Shanghai" />);
    expect(screen.getByText(translate("zh", "importWizard.done", {
      added: 12,
      theirs: 7,
      name: "小满",
      existing: 3,
    }))).toBeTruthy();
  });

  it("shows the reason and a retry when the import failed", () => {
    status = fileStatus("failed", { failedReason: "the disk was gone" });
    render(<ImportWizard fileId={11} personaName="小满" timezone="Asia/Shanghai" />);
    expect(screen.getByText(/the disk was gone/)).toBeTruthy();
    expect(screen.getByRole("button", { name: translate("zh", "importWizard.retry") })).toBeTruthy();
  });
});
