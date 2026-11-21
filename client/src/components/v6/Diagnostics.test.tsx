// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { translate } from "@/i18n";
import { formatDiagnoseReport, type DiagnoseItem } from "@shared/system-diagnose";

/**
 * The one-click diagnosis panel (C8.12).
 *
 * The server's answer is mocked here; this test is about what the panel does
 * with it: the loading state, the failure-with-retry state, the order the
 * problems are listed in, the extra item the browser can answer, and the
 * copied report being exactly the list.
 */

const mutateAsync = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      diagnose: {
        useMutation: () => ({ mutateAsync, isPending: false }),
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

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => toastSuccess(text),
    error: (text: string) => toastError(text),
  },
}));

import Diagnostics from "./Diagnostics";

const ITEMS: DiagnoseItem[] = [
  { id: "database", status: "ok", detail: "数据库连上了。" },
  { id: "redis", status: "skipped", detail: "没有可用的 Redis。" },
  { id: "ollama", status: "warn", detail: "连不上本机的 Ollama。", fix: "启动 Ollama。" },
  { id: "push.subscriptions", status: "fail", detail: "还没有浏览器订阅。", fix: "在浏览器里允许通知。" },
];

/** The item the panel adds itself, for the labels under test. */
function browserItem(): DiagnoseItem {
  return {
    id: "browserNotifications",
    status: "ok",
    detail: translate("zh", "diagnostics.browser.granted"),
  };
}

function labels() {
  return {
    title: translate("zh", "diagnostics.reportTitle"),
    status: {
      ok: translate("zh", "diagnostics.status.ok"),
      warn: translate("zh", "diagnostics.status.warn"),
      fail: translate("zh", "diagnostics.status.fail"),
      skipped: translate("zh", "diagnostics.status.skipped"),
    },
    fixPrefix: translate("zh", "diagnostics.fixPrefix"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ items: ITEMS });
  // A browser that can answer the notification question, allowed.
  vi.stubGlobal("Notification", { permission: "granted" });
});

describe("the diagnosis panel", () => {
  it("explains what the button will do before it is pressed", () => {
    render(<Diagnostics />);
    expect(
      screen.getByRole("button", { name: translate("zh", "diagnostics.run") }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("diagnostics").textContent).toContain(
      translate("zh", "diagnostics.note"),
    );
    expect(screen.getByTestId("diagnostics-empty").textContent).toContain(
      translate("zh", "diagnostics.empty"),
    );
  });

  it("says it is checking rather than saying there is nothing", async () => {
    mutateAsync.mockReturnValue(new Promise(() => {}));
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));
    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-loading")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("diagnostics-empty")).toBeNull();
  });

  it("reports a failed diagnosis and offers to try again", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("network down"));
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));

    const errorBox = await screen.findByTestId("diagnostics-error");
    expect(errorBox.textContent).toContain(
      translate("zh", "diagnostics.failed", { message: "network down" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: translate("zh", "diagnostics.retry") }),
    );
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
  });

  it("lists the problems first — red, then yellow, then the rest", async () => {
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));

    await waitFor(() => expect(screen.getAllByTestId("diagnostics-row").length).toBe(5));
    const statuses = screen
      .getAllByTestId("diagnostics-row")
      .map((row) => row.getAttribute("data-status"));
    expect(statuses).toEqual(["fail", "warn", "ok", "ok", "skipped"]);
    // Each row carries its result and, when it has one, its fix.
    const text = screen.getByTestId("diagnostics").textContent ?? "";
    expect(text).toContain("还没有浏览器订阅。");
    expect(text).toContain(translate("zh", "diagnostics.fixPrefix") + "启动 Ollama。");
  });

  it("adds the browser's notification permission itself", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));

    const rows = await screen.findAllByTestId("diagnostics-row");
    const browser = rows.find((row) => row.textContent?.includes("browserNotifications"));
    expect(browser).toBeDefined();
    expect(browser!.getAttribute("data-status")).toBe("warn");
    expect(browser!.textContent).toContain(translate("zh", "diagnostics.browser.denied"));
  });

  it("says the browser cannot tell it anything when notifications are unsupported", async () => {
    vi.stubGlobal("Notification", undefined);
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));

    const rows = await screen.findAllByTestId("diagnostics-row");
    const browser = rows.find((row) => row.textContent?.includes("browserNotifications"));
    expect(browser!.getAttribute("data-status")).toBe("skipped");
    expect(browser!.textContent).toContain(translate("zh", "diagnostics.browser.unsupported"));
  });

  it("copies exactly the list that is on the screen", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));
    await screen.findAllByTestId("diagnostics-row");

    fireEvent.click(screen.getByTestId("diagnostics-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const written = writeText.mock.calls[0][0] as string;
    // The same items, sorted the same way, written the same way.
    expect(written).toBe(
      formatDiagnoseReport([...ITEMS, browserItem()], labels()),
    );

    // And in the order the rows are in: each visible detail appears later in
    // the copied text than the one above it.
    const details = screen
      .getAllByTestId("diagnostics-detail")
      .map((node) => node.textContent ?? "");
    let previous = -1;
    for (const detail of details) {
      const at = written.indexOf(detail);
      expect(at).toBeGreaterThan(previous);
      previous = at;
    }
    // The report is also readable on screen, for the browsers with no
    // clipboard at all.
    expect(screen.getByTestId("diagnostics-report").textContent).toBe(written);
    expect(toastSuccess).toHaveBeenCalledWith(translate("zh", "diagnostics.copied"));
  });

  it("says the copy failed instead of pretending it worked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    // jsdom has no `execCommand`, so the fallback cannot save it either.
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));
    await screen.findAllByTestId("diagnostics-row");
    fireEvent.click(screen.getByTestId("diagnostics-copy"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(translate("zh", "diagnostics.copyFailed")),
    );
  });
});

describe("a second run that fails", () => {
  it("does not leave the old results or the copy button on screen", async () => {
    mutateAsync.mockResolvedValueOnce({ items: ITEMS });
    mutateAsync.mockRejectedValueOnce(new Error("network down"));
    render(<Diagnostics />);
    fireEvent.click(screen.getByTestId("diagnostics-run"));
    await screen.findAllByTestId("diagnostics-row");

    fireEvent.click(screen.getByTestId("diagnostics-run"));
    await screen.findByTestId("diagnostics-error");
    // The stale rows and the stale copy button are gone: what is on
    // screen is this run's failure, not the previous run's answer.
    expect(screen.queryAllByTestId("diagnostics-row")).toHaveLength(0);
    expect(screen.queryByTestId("diagnostics-copy")).toBeNull();
    expect(screen.queryByTestId("diagnostics-report-box")).toBeNull();
  });
});
