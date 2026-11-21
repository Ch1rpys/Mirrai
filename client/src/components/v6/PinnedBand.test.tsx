// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import PinnedBand from "./PinnedBand";

const marks = [
  { id: 1, messageId: 11, content: "在的呀，今天怎么样", label: null },
  { id: 2, messageId: 12, content: "晚安", label: null },
];

describe("the pinned band", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when nothing is pinned", () => {
    render(<PinnedBand marks={[]} onJump={vi.fn()} onUnpin={vi.fn()} />);
    expect(screen.queryByTestId("pinned-band")).toBeNull();
  });

  it("starts folded and shows the count", () => {
    render(<PinnedBand marks={marks} onJump={vi.fn()} onUnpin={vi.fn()} />);
    const band = screen.getByTestId("pinned-band");
    expect(band.textContent).toContain("置顶");
    expect(band.textContent).toContain("（2）");
    // Folded: the messages themselves are not on screen yet.
    expect(screen.queryByText(/在的呀，今天怎么样/)).toBeNull();
  });

  it("opens, jumps to a message, and unpins", async () => {
    const onJump = vi.fn();
    const onUnpin = vi.fn();
    render(<PinnedBand marks={marks} onJump={onJump} onUnpin={onUnpin} />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByText(/在的呀，今天怎么样/));
    expect(onJump).toHaveBeenCalledWith(11);

    await userEvent.click(screen.getAllByLabelText(translate("zh", "chat.unpin"))[0]!);
    expect(onUnpin).toHaveBeenCalledWith(1);
  });

  it("folds again", async () => {
    render(<PinnedBand marks={marks} onJump={vi.fn()} onUnpin={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText(/在的呀，今天怎么样/)).toBeNull();
  });
});
