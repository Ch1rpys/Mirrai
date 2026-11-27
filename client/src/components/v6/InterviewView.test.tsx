// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const next = vi.fn();
const finish = vi.fn();
const transcribeMutate = vi.fn();
let transcribeOptions: { onSuccess?: (result: { text: string }) => void } | undefined;
const navigate = vi.fn();
let nextQueue: Array<Record<string, unknown>> = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    interview: {
      next: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            next(input);
            const result =
              nextQueue.shift() ??
              { done: false, aspect: "address", question: "你们平时怎么称呼对方？", round: 1 };
            options?.onSuccess?.(result);
          },
          isPending: false,
        }),
      },
      finish: {
        useMutation: (options?: any) => ({
          mutate: (input: any) => {
            finish(input);
            options?.onSuccess?.({ personaId: 42, statements: 3, dropped: 0 });
          },
          isPending: false,
        }),
      },
      transcribe: {
        useMutation: (options?: { onSuccess?: (result: { text: string }) => void }) => {
          transcribeOptions = options;
          return { mutate: transcribeMutate, isPending: false };
        },
      },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/persona/new/interview", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import InterviewView from "./InterviewView";

describe("the interview (C1.8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextQueue = [];
  });

  it("opens with the words the manual promises", () => {
    render(<InterviewView initialName="小满" />);
    expect(screen.getByText(translate("zh", "interview.intro"))).toBeTruthy();
    expect(
      screen.getByText(translate("zh", "interview.title", { name: "小满" })),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText(translate("zh", "interview.nameLabel")) as HTMLInputElement).value,
    ).toBe("小满");
  });

  it("asks the first question after the name is given, and keeps the transcript", async () => {
    const user = userEvent.setup();
    render(<InterviewView initialName="小满" />);
    nextQueue = [
      { done: false, aspect: "address", question: "你们平时怎么称呼对方？", round: 1 },
      { done: false, aspect: "catchphrase", question: "TA 有没有常挂在嘴边的话？", round: 2 },
    ];

    await user.click(screen.getByRole("button", { name: translate("zh", "interview.start") }));
    await waitFor(() =>
      expect(screen.getByTestId("interview-question")).toHaveTextContent("你们平时怎么称呼对方？"),
    );
    expect(next).toHaveBeenCalledWith({ transcript: [] });

    await user.type(
      screen.getByLabelText(translate("zh", "interview.placeholder")),
      "他叫我小满，我叫他阿树",
    );
    await user.click(screen.getByRole("button", { name: translate("zh", "interview.send") }));
    await waitFor(() =>
      expect(screen.getByTestId("interview-question")).toHaveTextContent("TA 有没有常挂在嘴边的话？"),
    );
    expect(next).toHaveBeenLastCalledWith({
      transcript: [
        {
          aspect: "address",
          question: "你们平时怎么称呼对方？",
          answer: "他叫我小满，我叫他阿树",
        },
      ],
    });
    // What was said stays on screen.
    expect(screen.getByText("他叫我小满，我叫他阿树")).toBeTruthy();
  });

  it("ends immediately when 就这些 is pressed, writing the persona from the transcript", async () => {
    const user = userEvent.setup();
    render(<InterviewView initialName="小满" />);
    nextQueue = [
      { done: false, aspect: "address", question: "你们平时怎么称呼对方？", round: 1 },
      { done: true, aspect: null, question: "", round: 2, reason: "user-said-done" },
    ];

    await user.click(screen.getByRole("button", { name: translate("zh", "interview.start") }));
    await waitFor(() => screen.getByTestId("interview-question"));
    await user.type(
      screen.getByLabelText(translate("zh", "interview.placeholder")),
      "他叫我小满",
    );
    await user.click(screen.getByRole("button", { name: translate("zh", "interview.send") }));
    // The server answered "done" — the persona is written without another
    // question being asked.
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(finish.mock.calls[0]?.[0]).toMatchObject({
      name: "小满",
      transcript: [
        { aspect: "address", question: "你们平时怎么称呼对方？", answer: "他叫我小满" },
      ],
    });
    expect(navigate).toHaveBeenCalledWith("/persona/42/profile");
  });

  it("finishes at once with the 就这些 button", async () => {
    const user = userEvent.setup();
    render(<InterviewView initialName="小满" />);
    nextQueue = [
      { done: false, aspect: "address", question: "你们平时怎么称呼对方？", round: 1 },
    ];
    await user.click(screen.getByRole("button", { name: translate("zh", "interview.start") }));
    await waitFor(() => screen.getByTestId("interview-question"));
    await user.type(
      screen.getByLabelText(translate("zh", "interview.placeholder")),
      "他叫我小满",
    );
    await user.click(screen.getByRole("button", { name: translate("zh", "interview.done") }));
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]?.[0]).toMatchObject({
      name: "小满",
      transcript: [
        { aspect: "address", question: "你们平时怎么称呼对方？", answer: "他叫我小满" },
      ],
    });
  });

  it("puts a recording's words into the box, and only counts them when sent (C1.8)", async () => {
    // The InterviewView test used an empty transcribe mock before: it
    // never proved that the transcript lands in the box first rather
    // than straight into the transcript.
    class FakeRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() {
        this.onstop?.();
      }
    }
    const previousMediaRecorder = (window as any).MediaRecorder;
    (window as any).MediaRecorder = FakeRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    });
    try {
      const user = userEvent.setup();
      render(<InterviewView initialName="小满" />);
      nextQueue = [{ done: false, aspect: "address", question: "你们平时怎么称呼对方？", round: 1 }];
      await user.click(screen.getByRole("button", { name: translate("zh", "interview.start") }));
      await waitFor(() => screen.getByTestId("interview-question"));

      await user.click(screen.getByRole("button", { name: translate("zh", "interview.record") }));
      await user.click(
        await screen.findByRole("button", { name: translate("zh", "interview.stopRecording") }),
      );
      await waitFor(() => expect(transcribeMutate).toHaveBeenCalled());
      await act(async () => {
        transcribeOptions?.onSuccess?.({ text: "我平时叫他阿树" });
      });

      const box = screen.getByLabelText(translate("zh", "interview.placeholder")) as HTMLTextAreaElement;
      expect(box.value).toBe("我平时叫他阿树");
      // Not counted yet: the person reads it first.
      expect(next).toHaveBeenCalledWith({ transcript: [] });
      await user.click(screen.getByRole("button", { name: translate("zh", "interview.send") }));
      expect(next).toHaveBeenLastCalledWith({
        transcript: [
          { aspect: "address", question: "你们平时怎么称呼对方？", answer: "我平时叫他阿树" },
        ],
      });
    } finally {
      (window as any).MediaRecorder = previousMediaRecorder;
    }
  });

  it("describes an existing persona without asking for a name", async () => {
    render(<InterviewView personaId={5} personaName="小满" />);
    await waitFor(() =>
      expect(screen.getByTestId("interview-question")).toHaveTextContent("你们平时怎么称呼对方？"),
    );
    expect(next).toHaveBeenCalledWith({ transcript: [] });
    expect(finish).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(translate("zh", "interview.nameLabel"))).toBeNull();
  });
});
