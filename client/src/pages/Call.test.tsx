// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

const persona = {
  id: 5,
  name: "小满",
  userId: 1,
  settings: { layers: { callMode: true } },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: {
        useQuery: () => ({ data: persona, isLoading: false, isError: false }),
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
    user: { id: 1, name: "阿树", timezone: "Asia/Shanghai" },
  }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "5" }),
  useLocation: () => ["/persona/5/call", vi.fn()],
}));

vi.mock("@/contexts/LocaleContext", () => {
  /**
   * One `t` for the whole file. The page keeps `t` in the socket
   * effect's dependencies, so a fresh function per render would reopen
   * the WebSocket on every state change and the assertions would look at
   * the wrong socket.
   */
  const t = (key: any, params?: any) => translate("zh", key, params);
  return {
    useLocale: () => ({ t, locale: "zh", localeName: "中文", setLocale: () => {} }),
  };
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: any) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  emitBinary(bytes: ArrayBuffer) {
    this.onmessage?.({ data: bytes });
  }
}

/**
 * The clips the page asked the browser to play.
 *
 * Barge-in's second half is "do not play", so the test needs a player
 * that records every call rather than a real audio element.
 */
const played: FakeAudio[] = [];
const playCalls = vi.fn();

class FakeAudio {
  onended: (() => void) | null = null;
  constructor(public src: string) {
    played.push(this);
  }
  play = vi.fn(async () => {
    playCalls();
  });
  pause = vi.fn();
}

/** The room level the fake microphone reports: 128 is silence. */
let level = 128;

class FakeAnalyser {
  fftSize = 512;
  frequencyBinCount = 256;
  getByteTimeDomainData(buffer: Uint8Array) {
    buffer.fill(level);
  }
}

class FakeAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  close = vi.fn(async () => {});
}

class FakeMediaRecorder {
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
}

/** The animation frames the page asked for; the test steps them by hand. */
const frames: FrameRequestCallback[] = [];

import Call, { BARGE_IN_RMS, shouldBargeIn } from "./Call";

describe("barge-in", () => {
  it("only stops the answer when the user is actually speaking", () => {
    expect(shouldBargeIn(BARGE_IN_RMS - 0.01, true)).toBe(false);
    expect(shouldBargeIn(BARGE_IN_RMS + 0.01, true)).toBe(true);
    expect(shouldBargeIn(BARGE_IN_RMS + 0.01, false)).toBe(false);
  });
});

describe("the call page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeSocket.instances = [];
    played.length = 0;
    frames.length = 0;
    level = 128;
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:call-audio"),
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
  });

  it("connects, starts, offers to call anyway, and keeps the synthesis note", async () => {
    const user = userEvent.setup();
    render(<Call />);
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toContain("/api/call?personaId=5");
    socket.open();
    expect(socket.sent[0]).toBe(JSON.stringify({ type: "start" }));
    socket.emit({ type: "declined", slots: [{ weekday: 0, hour: 21, n: 3 }] });
    await waitFor(() => {
      expect(screen.getByText(/这个点 小满 一般不接电话/)).toBeInTheDocument();
      expect(screen.getByText(/周日 21 点/)).toBeInTheDocument();
    });
    expect(screen.getByText("合成的声音 · 不是 小满 本人")).toBeInTheDocument();
    await user.click(screen.getByText("还是打"));
    expect(
      FakeSocket.instances.some((instance) =>
        instance.sent.includes(JSON.stringify({ type: "start", force: true })),
      ),
    ).toBe(true);
  });

  it("says when the microphone was refused, and does not keep asking", async () => {
    render(<Call />);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({ type: "ready" });
    await waitFor(() => {
      expect(screen.getByText("麦克风没有开。")).toBeInTheDocument();
    });
    expect(screen.getByText(/在浏览器的地址栏旁边允许/)).toBeInTheDocument();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("does not play an audio frame that arrives after the user interrupted", async () => {
    /**
     * Barge-in, both halves (B7.14).
     *
     * The page only sends `interrupt` from the energy detector, so the
     * microphone has to open and the detector has to run for this test
     * to mean anything. The server may already have a sentence in the
     * speech engine when the interrupt arrives; on the fixed server it
     * never sends those bytes, but a frame already on the wire (or an
     * older server) must not talk over the person either.
     */
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
      },
    });
    render(<Call />);
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit({ type: "ready" });
    // The detector registers a frame only once the microphone is open.
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));

    // A sentence of the answer is playing.
    socket.emitBinary(new Uint8Array([1, 2, 3]).buffer);
    await waitFor(() => expect(played).toHaveLength(1));
    expect(playCalls).toHaveBeenCalledTimes(1);

    // The user speaks over it: barge-in stops the clip and asks the
    // server to interrupt the turn.
    level = 200;
    const tick = frames[frames.length - 1]!;
    await act(async () => {
      tick(0);
    });
    await waitFor(() =>
      expect(socket.sent).toContain(JSON.stringify({ type: "interrupt" })),
    );
    expect(played[0]!.pause).toHaveBeenCalled();

    // The sentence that was being synthesised arrives late. It belongs
    // to the answer the user already stopped.
    socket.emitBinary(new Uint8Array([4, 5, 6]).buffer);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(played).toHaveLength(1);
    expect(playCalls).toHaveBeenCalledTimes(1);

    // The page is not deaf afterwards: the next turn's audio plays.
    socket.emit({ type: "transcript", text: "等一下" });
    socket.emitBinary(new Uint8Array([7, 8, 9]).buffer);
    await waitFor(() => expect(played).toHaveLength(2));
  });
});
