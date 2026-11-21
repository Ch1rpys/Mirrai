// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/chat/last` — the shortcut's landing page (C8.8).
 *
 * The shortcut is a static URL, so the app has to decide which
 * conversation "last" means: the first persona the list returns (it is
 * sorted by recency) that is not locked.
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
  it("opens the most recent unlocked persona", async () => {
    listState.value = {
      isLoading: false,
      data: [
        { id: 9, locked: true },
        { id: 4, locked: false },
        { id: 2, locked: false },
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
