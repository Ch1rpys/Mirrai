// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The complete backup panel (C8.3).
 *
 * Two promises are on this screen and both have to hold: a failed read
 * never renders as "you have never run a backup", and a downloaded file
 * has to reach the browser's download machinery. The server's answers are
 * mocked here; what is under test is what the page does with them.
 */

const queryState: any = { value: {} };
const updateMutate = vi.fn();
let updateOptions: any = null;
const toastSuccess = vi.fn();
const toastError = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    backup: {
      getSettings: { useQuery: () => queryState.value },
      updateSettings: {
        useMutation: (options: any) => {
          updateOptions = options;
          return { mutate: updateMutate, isPending: false };
        },
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => toastSuccess(text),
    error: (text: string) => toastError(text),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import BackupPanel from "./BackupPanel";

/** The dictionary's word, as the localised test renderer would say it. */
function zh(key: string, params?: Record<string, string | number>): string {
  return (translate as any)("zh", key, params) as string;
}

const NEVER = {
  enabled: false,
  frequency: "daily",
  hasPassphrase: false,
  hasTargetPassword: false,
  hasTargetSecretAccessKey: false,
};

function setQuery(data: any, overrides: Record<string, unknown> = {}) {
  queryState.value = {
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setQuery(NEVER);
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:backup"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("the complete backup panel", () => {
  it("says it is reading, not that no backup has run", () => {
    setQuery(undefined, { isLoading: true });
    render(<BackupPanel />);
    const panel = screen.getByTestId("backup-panel");
    expect(panel.textContent).toContain(zh("settings.data.backup.loading"));
    expect(screen.queryByTestId("backup-never-run")).toBeNull();
  });

  it("reports a failed read and offers to try again — never the never-run text", async () => {
    const refetch = vi.fn();
    setQuery(undefined, { isError: true, refetch });
    render(<BackupPanel />);

    const failure = screen.getByTestId("backup-load-error");
    expect(failure.textContent).toContain(zh("settings.data.backup.loadFailed"));
    expect(screen.queryByTestId("backup-never-run")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: zh("settings.data.backup.retry") }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the never-run state, the copy and the download button for a new account", () => {
    render(<BackupPanel />);
    const panel = screen.getByTestId("backup-panel");
    expect(panel.textContent).toContain(zh("settings.data.backup.title"));
    expect(panel.textContent).toContain(zh("settings.data.backup.note"));
    expect(panel.textContent).toContain(zh("settings.data.backup.downloadDescription"));
    expect(screen.getByTestId("backup-never-run").textContent).toContain(
      zh("settings.data.backup.neverRun"),
    );
    expect(
      screen.getByRole("button", { name: zh("settings.data.backup.download") }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("backup-last-error")).toBeNull();
  });

  it("says the last scheduled failure in words, not as its token", () => {
    setQuery({ ...NEVER, lastError: "folder_missing" });
    render(<BackupPanel />);
    const failure = screen.getByTestId("backup-last-error");
    expect(failure.textContent).toContain(zh("settings.data.backup.errors.folderMissing"));
    expect(failure.textContent).toContain(
      zh("settings.data.backup.lastErrorTitle", {
        message: zh("settings.data.backup.errors.folderMissing"),
      }),
    );
    expect(screen.getByTestId("backup-panel").textContent).not.toContain("folder_missing");
  });

  it("keeps a stored secret by showing the keep-stored placeholder, not the secret", () => {
    setQuery({
      ...NEVER,
      enabled: true,
      target: { kind: "webdav", url: "https://dav.example.com/mirrai", username: "me" },
      hasPassphrase: true,
      hasTargetPassword: true,
    });
    render(<BackupPanel />);
    expect(screen.getByTestId("backup-webdav-password")).toHaveAttribute(
      "placeholder",
      zh("settings.data.backup.keepStored"),
    );
    expect(screen.getByTestId("backup-scheduled-passphrase")).toHaveAttribute(
      "placeholder",
      zh("settings.data.backup.keepStored"),
    );
  });

  it("will not turn a remote target on without a passphrase, then saves the typed values", async () => {
    render(<BackupPanel />);
    await userEvent.selectOptions(
      screen.getByLabelText(zh("settings.data.backup.targetLabel")),
      "webdav",
    );
    await userEvent.type(
      screen.getByLabelText(zh("settings.data.backup.webdavUrlLabel")),
      "https://dav.example.com/mirrai",
    );
    await userEvent.type(
      screen.getByLabelText(zh("settings.data.backup.usernameLabel")),
      "me",
    );
    await userEvent.click(
      screen.getByRole("switch", { name: zh("settings.data.backup.enableSwitch") }),
    );
    await userEvent.click(screen.getByTestId("backup-save"));

    // A backup that leaves this machine is encrypted; without a passphrase
    // it would have to be written in the clear.
    expect(updateMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("backup-save-error").textContent).toContain(
      zh("settings.data.backup.remotePassphraseRequired"),
    );

    await userEvent.type(
      screen.getByLabelText(zh("settings.data.backup.scheduledPassphraseLabel")),
      "a-long-passphrase",
    );
    await userEvent.click(screen.getByTestId("backup-save"));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith({
      enabled: true,
      frequency: "daily",
      target: { kind: "webdav", url: "https://dav.example.com/mirrai", username: "me" },
      passphrase: "a-long-passphrase",
    });
  });

  it("saves a folder target and the chosen frequency", async () => {
    render(<BackupPanel />);
    await userEvent.type(screen.getByTestId("backup-folder-path"), "/Users/me/Mirrai backups");
    await userEvent.selectOptions(
      screen.getByLabelText(zh("settings.data.backup.frequencyLabel")),
      "weekly",
    );
    await userEvent.click(screen.getByTestId("backup-save"));

    expect(updateMutate).toHaveBeenCalledWith({
      enabled: false,
      frequency: "weekly",
      target: { kind: "folder", path: "/Users/me/Mirrai backups" },
    });
  });

  it("says the settings were saved after the server accepts them", async () => {
    render(<BackupPanel />);
    await act(async () => {
      updateOptions.onSuccess({ ...NEVER, frequency: "weekly" });
    });
    expect(toastSuccess).toHaveBeenCalledWith(zh("settings.data.backup.saved"));
  });

  it("posts the passphrase and starts a download named by the server", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-disposition"
            ? 'attachment; filename="mirrai-backup-20260101-000000.mirrai-backup"'
            : null,
      },
      blob: async () => new Blob(["zip-bytes"], { type: "application/octet-stream" }),
    });
    render(<BackupPanel />);
    await userEvent.type(
      screen.getByLabelText(zh("settings.data.backup.passphraseLabel")),
      "correct horse",
    );
    await userEvent.click(
      screen.getByRole("button", { name: zh("settings.data.backup.download") }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/backup/download");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ passphrase: "correct horse" });

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
    expect(anchorClick).toHaveBeenCalled();
    const anchor = anchorClick.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("mirrai-backup-20260101-000000.mirrai-backup");
  });

  it("does not ask the server for a backup with a passphrase that is too short", async () => {
    render(<BackupPanel />);
    await userEvent.type(
      screen.getByLabelText(zh("settings.data.backup.passphraseLabel")),
      "short",
    );
    await userEvent.click(
      screen.getByRole("button", { name: zh("settings.data.backup.download") }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("backup-download-error").textContent).toContain(
      zh("settings.data.backup.passphraseTooShort"),
    );
  });

  it("says a failed download failed, with the server's own words when it sent them", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      headers: { get: () => null },
      json: async () => ({ error: "备份没有下载成功。" }),
    });
    render(<BackupPanel />);
    await userEvent.type(
      screen.getByLabelText(zh("settings.data.backup.passphraseLabel")),
      "correct horse",
    );
    fireEvent.click(screen.getByRole("button", { name: zh("settings.data.backup.download") }));

    await waitFor(() => expect(screen.getByTestId("backup-download-error")).toBeInTheDocument());
    expect(screen.getByTestId("backup-download-error").textContent).toContain(
      zh("settings.data.backup.downloadFailed", { message: "备份没有下载成功。" }),
    );
  });
});
