// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/chat/last` — the shortcut's landing page (C8.8).
 *
 * The shortcut is a static URL, so the app has to decide which
 * conversation "last" means. The list arrives ordered by `updatedAt`,
 * which is the last *edit*, not the last conversation — so the page
 * sorts by `lastChatAt` itself.
 */

const navigate = vi.fn();
const listState: { value: any } = { value: undefined };

vi.mock("wouter", () => ({
  useLocation: () => ["/chat/last", navigate],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: string) => key,
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      list: { useQuery: () => listState.value },
    },
  },
}));

import ChatLast from "./ChatLast";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the last-chat shortcut", () => {
  it("opens the most recently *talked to* unlocked persona, not the last edited", async () => {
    listState.value = {
      isLoading: false,
      // The list is ordered by updatedAt (last edit). The conversations
      // happened the other way round: 4 talked most recently.
      data: [
        { id: 9, locked: true, lastChatAt: new Date("2026-11-21T10:00:00Z") },
        { id: 2, locked: false, lastChatAt: new Date("2026-11-20T10:00:00Z"), updatedAt: new Date("2026-11-21T09:00:00Z") },
        { id: 4, locked: false, lastChatAt: new Date("2026-11-21T08:00:00Z"), updatedAt: new Date("2026-11-19T00:00:00Z") },
      ],
    };
    render(<ChatLast />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/chat/4", { replace: true }));
  });

  it("falls back to the lobby when there is nobody to open", async () => {
    listState.value = { isLoading: false, data: [{ id: 9, locked: true }] };
    render(<ChatLast />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
  });
});
