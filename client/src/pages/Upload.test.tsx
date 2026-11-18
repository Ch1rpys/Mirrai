// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The files that are on their way.
 *
 * The row's key was the file's name plus the clock — so two files with
 * the same name uploaded in the same millisecond were **one row**, and
 * the row of the first one was deleted when the second one finished:
 * the first file was left uploading for ever.
 */

const upload = vi.fn();
const refetchFiles = vi.fn();
const distillPage = vi.hoisted(() => ({
  status: "ready" as string,
  files: [] as unknown[],
  estimate: { chunks: 0, chars: 0, mapCalls: 0, reduceCalls: 0, calls: 4 },
  collected: 0,
  confirm: true,
  trigger: vi.fn(),
  ask: vi.fn(async () => true),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    skillEngine: {
      getResearchProfile: { useQuery: () => ({ data: undefined }) },
      getJobStatus: { useQuery: () => ({ data: undefined, error: null }) },
      exportSkill: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      estimate: { useQuery: () => ({ data: distillPage.estimate }) },
    },
    persona: {
      get: { useQuery: () => ({ data: { id: 1, name: "小A", analysisStatus: distillPage.status }, refetch: vi.fn(), isError: false }) },
      decideHarm: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clarifications: { useQuery: () => ({ data: { questions: [] }, isLoading: false, isError: false, refetch: vi.fn() }) },
      answerClarification: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getSettings: { useQuery: () => ({ data: { pendingRedistillAdded: 0, pendingRedistillRemoved: false }, refetch: vi.fn() }) },
      getAnalysisStatus: { useQuery: () => ({ data: { status: distillPage.status }, refetch: vi.fn() }) },
      triggerAnalysis: { useMutation: () => ({ mutate: distillPage.trigger, isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    file: {
      list: { useQuery: () => ({ data: distillPage.files, refetch: refetchFiles, isLoading: false, isError: false }) },
      upload: { useMutation: () => ({ mutateAsync: upload, isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    record: {
      sources: { useQuery: () => ({ data: [] }) },
      deleteSource: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    material: {
      report: { useQuery: () => ({ data: undefined, isError: false }) },
    },
    import: {
      backfill: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      formats: { useQuery: () => ({ data: [{ id: "generic-line", label: "一行一条" }] }) },
      status: { useQuery: () => ({ data: undefined, error: null, refetch: vi.fn() }) },
      preview: { useQuery: () => ({ data: undefined }) },
      confirm: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      resume: { useMutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }) },
      cancel: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    collector: {
      preview: { useQuery: () => ({ data: { total: distillPage.collected } }) },
    },
    useUtils: () => ({
      persona: {
        getSettings: { invalidate: vi.fn() },
        get: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" }, isAuthenticated: true, loading: false }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1/upload", vi.fn()],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/ConfirmDialog", () => ({
  useConfirm: () => distillPage.ask,
  ConfirmProvider: ({ children }: { children: any }) => children,
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/components/DistillationModePicker", () => ({
  default: () => <div data-testid="mode-picker" />,
}));

import Upload from "./Upload";

/**
 * The file reader.
 *
 * The browser reads the file and hands back its bytes; the test does
 * not need a real file for that, and jsdom's reader does not fire
 * inside a test.
 */
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    this.result = "data:text/plain;base64,aGVsbG8=";
    setTimeout(() => this.onload?.(), 0);
  }
}

/** A file of the user's own, in the browser's own shape. */
function makeFile(name: string, type = "text/plain"): File {
  return new File(["hello"], name, { type });
}

describe("the files that are on their way", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    distillPage.status = "ready";
    distillPage.files = [];
    distillPage.estimate = { chunks: 0, chars: 0, mapCalls: 0, reduceCalls: 0, calls: 4 };
    distillPage.collected = 0;
    distillPage.confirm = true;
    distillPage.trigger.mockReset();
    distillPage.ask.mockReset();
    distillPage.ask.mockImplementation(async () => distillPage.confirm);
    // The uploads stay on their way: a row that is finished is taken
    // off the panel.
    upload.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps two files of the same name apart", async () => {
    /**
     * The same millisecond for both files.
     *
     * That is what makes the two rows collide: the key was the name
     * plus the clock.
     */
    vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
    vi.stubGlobal("FileReader", FakeFileReader);
    render(<Upload />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Two files with the same name, chosen in the same millisecond.
    fireEvent.change(input, { target: { files: [makeFile("chat.txt")] } });
    await waitFor(() => {
      expect(screen.getAllByText("chat.txt").length).toBe(1);
    });
    fireEvent.change(input, { target: { files: [makeFile("chat.txt")] } });

    await waitFor(() => {
      expect(screen.getAllByText("chat.txt").length).toBe(2);
    });
  });

  it("offers to try a failed upload again", async () => {
    /**
     * The failed row could only be dismissed — so a file that failed
     * because the network was shaky had to be found and chosen all
     * over again.
     */
    vi.stubGlobal("FileReader", FakeFileReader);
    // The first upload fails.
    upload.mockRejectedValueOnce(new Error("the network went away"));
    render(<Upload />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("notes.txt")] } });

    const retry = await screen.findByRole("button", {
      name: translate("zh", "upload.retryFailed", { name: "notes.txt" }),
    });

    // And it works: the same file goes up again.
    upload.mockImplementation(() => Promise.resolve({}));
    fireEvent.click(retry);

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(2);
    });
    const last = upload.mock.calls[upload.mock.calls.length - 1][0] as any;
    expect(last.fileName).toBe("notes.txt");
  });

  it("shows the file's own name, not the row's key", async () => {
    vi.stubGlobal("FileReader", FakeFileReader);
    render(<Upload />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const files = [makeFile("notes.txt")];
    fireEvent.change(input, { target: { files } });

    await waitFor(() => {
      expect(screen.getAllByText("notes.txt").length).toBe(1);
    });
    // The key is not shown to the person.
    expect(screen.queryByText(/notes\.txt#/)).toBeNull();
  });

  it("lists the formats the server actually supports", () => {
    render(<Upload />);
    expect(screen.getByText(translate("zh", "upload.formatsHint", { formats: "一行一条" }))).toBeTruthy();
  });

  it("streams a zip through the import upload route", async () => {
    const send = vi.fn();
    class FakeXHR {
      upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
      status = 200;
      responseText = JSON.stringify({ fileId: 9 });
      withCredentials = false;
      open = vi.fn();
      setRequestHeader = vi.fn();
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      send(body: unknown) {
        send(body);
        this.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 80 });
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    render(<Upload />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile("chat.zip", "application/zip")] } });
    await waitFor(() => {
      expect(send).toHaveBeenCalled();
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows how much of the record this run will read", () => {
    distillPage.status = "pending";
    distillPage.collected = 3;
    distillPage.estimate = { chunks: 24, chars: 140_000, mapCalls: 24, reduceCalls: 4, calls: 31 };

    render(<Upload />);
    expect(screen.getByText(/这次会读 24 段记录（约 14 万字），大约调用模型 31 次/)).toBeTruthy();
  });

  it("asks once more when the estimate is over a hundred calls, and can stop", async () => {
    distillPage.status = "pending";
    distillPage.collected = 3;
    distillPage.estimate = { chunks: 24, chars: 140_000, mapCalls: 24, reduceCalls: 4, calls: 120 };
    distillPage.confirm = false;

    render(<Upload />);
    fireEvent.click(screen.getByRole("button", { name: "开始 AI 解析，生成数字分身" }));

    await waitFor(() => {
      expect(distillPage.ask).toHaveBeenCalled();
    });
    expect(distillPage.ask).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("120") }),
    );
    expect(distillPage.trigger).not.toHaveBeenCalled();
  });
});
