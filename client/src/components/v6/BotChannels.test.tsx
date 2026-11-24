// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The bot channels on the settings page (C9.1).
 *
 * Only the three channels that were actually implemented and verified
 * against their protocol documentation are listed: Telegram, Discord and
 * Matrix. QQ and WeCom need a reviewed platform account and a public
 * callback, so they must not appear as if they were available.
 */
const state = vi.hoisted(() => ({
  calls: [] as Array<{ kind: string; input: unknown }>,
  bindCode: "123456" as string | null,
  personas: [{ id: 1, name: "小满", analysisStatus: "ready" }] as any[],
  statusError: false,
}));

const refetch = vi.fn();

vi.mock("@/lib/trpc", () => {
  const mutation = (kind: string) => (options?: any) => ({
    mutate: (input: unknown) => {
      state.calls.push({ kind, input });
      options?.onSuccess?.({});
    },
    isPending: false,
  });
  return {
    trpc: {
      channel: {
        getStatus: {
          useQuery: ({ channel }: { channel: string }) => ({
            data: {
              channel,
              connected: false,
              status: "stopped",
              detail: state.bindCode ? { bindCode: state.bindCode } : {},
            },
            isError: state.statusError,
            isPending: false,
            refetch,
          }),
        },
        getChannelDefault: {
          useQuery: () => ({ data: { personaId: null }, isPending: false, refetch }),
        },
        setBotCredentials: { useMutation: mutation("save") },
        start: { useMutation: mutation("start") },
        stop: { useMutation: mutation("stop") },
        setChannelDefault: { useMutation: mutation("default") },
      },
      persona: {
        list: {
          useQuery: () => ({ data: state.personas, isPending: false }),
        },
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import BotChannels from "./BotChannels";

function cardFor(label: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: label });
  return heading.closest("section") as HTMLElement;
}

describe("the bot channels on the settings page (C9.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls = [];
    state.bindCode = "123456";
    state.statusError = false;
    state.personas = [{ id: 1, name: "小满", analysisStatus: "ready" }];
  });

  it("lists exactly the three implemented channels and nothing unverified", () => {
    const { container } = render(<BotChannels />);
    const headings = Array.from(container.querySelectorAll("h3")).map((node) => node.textContent);
    expect(headings).toEqual(["Telegram", "Discord", "Matrix"]);
    expect(screen.queryByText(/QQ|企业微信|WeCom/i)).toBeNull();
    expect(screen.queryByText(/Slack/i)).toBeNull();
  });

  it("shows the one-time bind code each channel is waiting on", () => {
    render(<BotChannels />);
    for (const [label, channel] of [
      ["Telegram", "telegram"],
      ["Discord", "discord"],
      ["Matrix", "matrix"],
    ] as const) {
      const card = cardFor(label);
      expect(within(card).getByTestId(`bind-code-${channel}`).textContent).toContain("123456");
    }
  });

  it("saves a bot token for the channel it was typed into", async () => {
    const user = userEvent.setup();
    render(<BotChannels />);
    const card = cardFor("Telegram");
    await user.type(
      within(card).getByLabelText(translate("zh", "channelsBot.tokenLabel")),
      "123456:ABC",
    );
    await user.click(within(card).getByRole("button", { name: translate("zh", "channelsBot.save") }));
    expect(state.calls).toContainEqual({
      kind: "save",
      input: {
        channel: "telegram",
        credentials: { accessToken: "123456:ABC", botToken: "123456:ABC" },
      },
    });
  });

  it("saves the homeserver with a Matrix access token", async () => {
    const user = userEvent.setup();
    render(<BotChannels />);
    const card = cardFor("Matrix");
    await user.type(
      within(card).getByLabelText(translate("zh", "channelsBot.accessTokenLabel")),
      "syt_token",
    );
    await user.type(
      within(card).getByLabelText(translate("zh", "channelsBot.homeserverLabel")),
      "matrix.example.org",
    );
    await user.click(within(card).getByRole("button", { name: translate("zh", "channelsBot.save") }));
    expect(state.calls).toContainEqual({
      kind: "save",
      input: {
        channel: "matrix",
        credentials: {
          accessToken: "syt_token",
          botToken: "syt_token",
          homeserverUrl: "matrix.example.org",
        },
      },
    });
  });

  it("starts and stops a channel", async () => {
    const user = userEvent.setup();
    render(<BotChannels />);
    const card = cardFor("Discord");
    await user.click(within(card).getByRole("button", { name: translate("zh", "channelsBot.start") }));
    await user.click(within(card).getByRole("button", { name: translate("zh", "channelsBot.stop") }));
    expect(state.calls).toEqual([
      { kind: "start", input: { channel: "discord" } },
      { kind: "stop", input: { channel: "discord" } },
    ]);
  });

  it("says the status could not be read instead of saying the channel is stopped", () => {
    state.statusError = true;
    render(<BotChannels />);
    const card = cardFor("Telegram");
    expect(within(card).getByText(translate("zh", "channelsBot.loadFailed"))).toBeTruthy();
    expect(within(card).queryByText(translate("zh", "channelsBot.stopped"))).toBeNull();
  });
});
