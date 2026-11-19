// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

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
}

import Call from "./Call";

describe("the call page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
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
});
