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

import MarksPanel from "./MarksPanel";

const marks = [
  { id: 1, messageId: 11, kind: "star", label: null, content: "在的呀，今天怎么样" },
  { id: 2, messageId: 12, kind: "topic", label: "那天晚上的事", content: "我们说说那次吧" },
  { id: 3, messageId: 13, kind: "pin", label: null, content: "晚安" },
];

describe("the stars and topics panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while it is closed", () => {
    render(
      <MarksPanel open={false} marks={marks} onClose={vi.fn()} onJump={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the stars and the topics separately", () => {
    render(
      <MarksPanel open marks={marks} onClose={vi.fn()} onJump={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("收藏的句子")).toBeTruthy();
    expect(screen.getByText(/在的呀，今天怎么样/)).toBeTruthy();
    expect(screen.getByText("那天晚上的事")).toBeTruthy();
    // A pin is not a star or a topic, and is not listed here.
    expect(screen.queryByText("晚安")).toBeNull();
  });

  it("jumps to the message a mark points at", async () => {
    const onJump = vi.fn();
    render(
      <MarksPanel open marks={marks} onClose={vi.fn()} onJump={onJump} onRemove={vi.fn()} />,
    );
    await userEvent.click(screen.getByText(/在的呀/));
    expect(onJump).toHaveBeenCalledWith(11);
    await userEvent.click(screen.getByText("那天晚上的事"));
    expect(onJump).toHaveBeenCalledWith(12);
  });

  it("removes a star", async () => {
    const onRemove = vi.fn();
    render(
      <MarksPanel open marks={marks} onClose={vi.fn()} onJump={vi.fn()} onRemove={onRemove} />,
    );
    await userEvent.click(screen.getByLabelText(translate("zh", "chat.unstar")));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("says when there is nothing yet", () => {
    render(
      <MarksPanel open marks={[]} onClose={vi.fn()} onJump={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText(translate("zh", "chat.noStars"))).toBeTruthy();
    expect(screen.getByText(translate("zh", "chat.noTopics"))).toBeTruthy();
  });
});
