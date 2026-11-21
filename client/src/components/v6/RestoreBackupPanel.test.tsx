// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * Restoring a backup on the first-run page (C8.3).
 *
 * The panel asks the server first whether this instance is still empty.
 * "Not empty" is an answer and the panel disappears; "could not ask" is a
 * failure and says so, with a way to try again. After that, the restore
 * posts raw bytes and the passphrase in a base64 header — never in the
 * URL, where an access log would keep it.
 */

let fetchMock: ReturnType<typeof vi.fn>;

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import RestoreBackupPanel from "./RestoreBackupPanel";

/** The dictionary's word, as the localised test renderer would say it. */
function zh(key: string, params?: Record<string, string | number>): string {
  return (translate as any)("zh", key, params) as string;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

/** Answers the availability check and the restore request by URL. */
function routeFetch(restore: () => Promise<unknown>) {
  fetchMock.mockImplementation(async (url: unknown) => {
    if (url === "/api/backup/available") return jsonResponse({ available: true });
    if (url === "/api/backup/restore") return restore();
    throw new Error(`unexpected fetch: ${String(url)}`);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("the restore panel", () => {
  it("renders nothing when the instance already has an account", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ available: false }));
    const { container } = render(<RestoreBackupPanel />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByTestId("restore-backup-panel")).toBeNull();
    expect(screen.queryByTestId("restore-check-failed")).toBeNull();
  });

  it("offers the form, the file picker and the passphrase field when the instance is empty", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ available: true }));
    render(<RestoreBackupPanel />);

    const panel = await screen.findByTestId("restore-backup-panel");
    expect(panel.textContent).toContain(zh("restoreBackup.title"));
    expect(panel.textContent).toContain(zh("restoreBackup.note"));
    expect(screen.getByTestId("restore-backup-file")).toHaveAttribute(
      "accept",
      ".zip,.mirrai-backup",
    );
    expect(screen.getByTestId("restore-start")).toBeInTheDocument();
    expect(screen.getByLabelText(zh("restoreBackup.passphraseLabel"))).toBeInTheDocument();
  });

  it("distinguishes a failed availability check from an unavailable instance, and retries", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<RestoreBackupPanel />);

    const failed = await screen.findByTestId("restore-check-failed");
    expect(failed.textContent).toContain(zh("restoreBackup.checkFailed"));

    // The retry succeeds; the form appears.
    fetchMock.mockResolvedValueOnce(jsonResponse({ available: true }));
    await userEvent.click(screen.getByRole("button", { name: zh("restoreBackup.retry") }));
    expect(await screen.findByTestId("restore-backup-panel")).toBeInTheDocument();
  });

  it("posts the file as bytes and the passphrase as a base64 header", async () => {
    routeFetch(async () =>
      jsonResponse({
        ok: true,
        message: "备份还原完成。用原来的账号登录。",
        rows: 42,
        files: 3,
        tables: 12,
      }),
    );
    render(<RestoreBackupPanel />);
    await screen.findByTestId("restore-backup-panel");

    const file = new File(["backup-bytes"], "mirrai.mirrai-backup", {
      type: "application/octet-stream",
    });
    fireEvent.change(screen.getByTestId("restore-backup-file"), {
      target: { files: [file] },
    });
    expect(screen.getByTestId("restore-chosen-file").textContent).toContain(
      "mirrai.mirrai-backup",
    );

    await userEvent.type(
      screen.getByLabelText(zh("restoreBackup.passphraseLabel")),
      "open sesame",
    );
    await userEvent.click(screen.getByTestId("restore-start"));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([url]) => url === "/api/backup/restore");
      expect(calls.length).toBe(1);
    });
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/backup/restore")!;
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["x-mirrai-backup-passphrase"]).toBe(btoa("open sesame"));
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe("backup-bytes");

    // The server's own sentence is what is shown, plus the way back to a
    // sign-in form.
    const done = await screen.findByTestId("restore-done");
    expect(done.textContent).toContain("备份还原完成。用原来的账号登录。");
    expect(done.textContent).toContain(zh("restoreBackup.goSignIn"));
  });

  it("says the server's error when the restore is refused", async () => {
    const refusal = "这个 Mirrai 里已经有账号了，备份只能还原到一个全新的 Mirrai。";
    routeFetch(async () => jsonResponse({ error: refusal }, false, 403));
    render(<RestoreBackupPanel />);
    await screen.findByTestId("restore-backup-panel");

    fireEvent.change(screen.getByTestId("restore-backup-file"), {
      target: { files: [new File(["bytes"], "backup.mirrai-backup")] },
    });
    await userEvent.click(screen.getByTestId("restore-start"));

    const error = await screen.findByTestId("restore-error");
    expect(error.textContent).toContain(refusal);
  });

  it("asks for a file before posting anything", async () => {
    routeFetch(async () => jsonResponse({ ok: true, message: "unused" }));
    render(<RestoreBackupPanel />);
    await screen.findByTestId("restore-backup-panel");

    await userEvent.click(screen.getByTestId("restore-start"));

    expect(screen.getByTestId("restore-error").textContent).toContain(
      zh("restoreBackup.noFile"),
    );
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/backup/restore")).toHaveLength(0);
  });
});
