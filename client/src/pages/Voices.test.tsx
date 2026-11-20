// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The soundtrack page.
 *
 * Three states have to be different: loading, a failed read (with a
 * retry), and a record that really has no recordings. The search is a
 * server query — the transcript is not on the screen to filter.
 */

const lastInput: { value?: any } = {};
const listState: { value: any } = { value: undefined };
const statusState: { value: any } = { value: undefined };
const transcribe = vi.fn();
const refetch = vi.fn();
const marksRefetch = vi.fn();
const addMark = vi.fn();
const removeMark = vi.fn();
const marksState: { value: any } = { value: { data: [] } };

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/voices", vi.fn()],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" }, isAuthenticated: true }),
}));

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
    persona: {
      get: { useQuery: () => ({ data: { id: 5, name: "小满" }, isLoading: false }) },
    },
    media: {
      listVoices: {
        useQuery: (input: any) => {
          lastInput.value = input;
          return listState.value;
        },
      },
      transcribeStatus: { useQuery: () => ({ data: statusState.value, refetch }) },
      transcribe: {
        useMutation: () => ({ mutate: transcribe, isPending: false }),
      },
    },
    record: {
      marks: {
        list: { useQuery: () => ({ refetch: marksRefetch, ...marksState.value }) },
        add: {
          useMutation: (options?: any) => ({
            mutate: (input: any) => {
              addMark(input);
              options?.onSuccess?.();
            },
          }),
        },
        remove: {
          useMutation: (options?: any) => ({
            mutate: (input: any) => {
              removeMark(input);
              options?.onSuccess?.();
            },
          }),
        },
      },
    },
  },
}));

vi.mock("@/components/PageLoader", () => ({
  default: () => <div data-testid="page-loader" />,
}));

import Voices from "./Voices";

const voice = {
  id: 11,
  at: "2022-03-01T12:00:00.000Z",
  durationSec: 12,
  fromThem: true,
  transcript: "刚下课",
  transcriptEngine: "whisper-cpp",
  url: "/uploads/personas/1/5/imports/1/a.ogg",
  recordId: 101,
};

describe("the soundtrack page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastInput.value = undefined;
    marksState.value = { data: [] };
    listState.value = {
      data: { voices: [voice], nextCursor: null },
      isLoading: false,
      isError: false,
      refetch,
    };
    statusState.value = {
      run: { running: false, total: 0, done: 0, failed: 0, startedAt: null, lastError: null },
      engine: "whisper-cpp",
      local: true,
    };
  });

  it("lists a recording with its date, who said it, and its transcript", () => {
    render(<Voices />);
    expect(screen.getByText(translate("zh", "media.voicesTitle", { name: "小满" }))).toBeInTheDocument();
    expect(
      screen.getByText(translate("zh", "media.voicesNote")),
    ).toBeInTheDocument();
    expect(screen.getByText("刚下课")).toBeInTheDocument();
    expect(screen.getByText(/12 秒/)).toBeInTheDocument();
    expect(screen.getByText(/记录第 101 条/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translate("zh", "media.transcribeAction") })).toBeEnabled();
  });

  it("searches the transcripts through the server", async () => {
    const user = userEvent.setup();
    render(<Voices />);
    await user.type(
      screen.getByLabelText(translate("zh", "media.voicesSearch")),
      "下课",
    );
    expect(lastInput.value.q).toBe("下课");
  });

  it("says the record has no recordings rather than showing a blank page", () => {
    listState.value = {
      data: { voices: [], nextCursor: null },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Voices />);
    expect(
      screen.getByText(translate("zh", "media.voicesEmpty", { name: "小满" })),
    ).toBeInTheDocument();
  });

  it("shows a failed read with a retry", async () => {
    const user = userEvent.setup();
    listState.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    };
    render(<Voices />);
    expect(
      screen.getByText(translate("zh", "media.voicesLoadFailed")),
    ).toBeInTheDocument();
    await user.click(screen.getByText(translate("zh", "common.retry")));
    expect(refetch).toHaveBeenCalled();
  });

  it("says what to set when no local engine is configured", () => {
    statusState.value = {
      run: { running: false, total: 0, done: 0, failed: 0, startedAt: null, lastError: null },
      engine: "provider",
      local: false,
    };
    render(<Voices />);
    expect(
      screen.getByText(translate("zh", "media.voicesNoEngine")),
    ).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "media.transcribeAction"))).toBeNull();
  });

  it("marks a recording that has no words yet", () => {
    listState.value = {
      data: {
        voices: [{ ...voice, transcript: null, transcriptEngine: null }],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Voices />);
    expect(
      screen.getByText(translate("zh", "media.voicesUntranscribed")),
    ).toBeInTheDocument();
  });

  it("starts the transcription task", async () => {
    const user = userEvent.setup();
    render(<Voices />);
    await user.click(
      screen.getByRole("button", { name: translate("zh", "media.transcribeAction") }),
    );
    expect(transcribe).toHaveBeenCalledWith({ personaId: 5 });
  });
  it("favorites a recording by bookmarking its record (C7.3)", async () => {
    marksState.value = {
      data: [{ id: 7, recordId: 101, kind: "bookmark" }],
    };
    const user = userEvent.setup();
    render(<Voices />);
    expect(screen.getByText(translate("zh", "media.voicesFavorited"))).toBeInTheDocument();
    await user.click(screen.getByText(translate("zh", "media.voicesFavorited")));
    expect(removeMark).toHaveBeenCalledWith({ personaId: 5, id: 7 });
  });

  it("shows only the favorites when asked (C7.3)", async () => {
    listState.value = {
      data: {
        voices: [
          voice,
          { ...voice, id: 12, recordId: 102, transcript: "另一条", at: "2022-04-01T12:00:00.000Z" },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      refetch,
    };
    marksState.value = { data: [{ id: 7, recordId: 101, kind: "bookmark" }] };
    const user = userEvent.setup();
    render(<Voices />);
    await user.click(screen.getByLabelText(translate("zh", "media.voicesOnlyFavorites")));
    expect(screen.getByText("刚下课")).toBeInTheDocument();
    expect(screen.queryByText("另一条")).toBeNull();
  });

  it("continues to the next recording in time order (C7.3)", () => {
    listState.value = {
      data: {
        voices: [
          { ...voice, id: 12, recordId: 102, transcript: "后一条", at: "2022-04-01T12:00:00.000Z", url: "/uploads/personas/1/5/imports/1/b.ogg" },
          voice,
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      refetch,
    };
    render(<Voices />);
    // The list is newest-first; play the older one, and the next in time
    // is the newer one.
    const playButtons = screen.getAllByText(translate("zh", "media.voicesPlay"));
    fireEvent.click(playButtons[1]);
    const player = screen.getByTestId("voices-player") as HTMLAudioElement;
    expect(player.getAttribute("src")).toContain("a.ogg");
    fireEvent.ended(player);
    expect((screen.getByTestId("voices-player") as HTMLAudioElement).getAttribute("src"))
      .toContain("b.ogg");
  });

  it("offers the original file for download (C7.3)", () => {
    render(<Voices />);
    const link = screen.getByText(translate("zh", "media.voicesDownload")).closest("a");
    expect(link).toHaveAttribute("href", "/uploads/personas/1/5/imports/1/a.ogg");
    expect(link).toHaveAttribute("download");
  });

});
