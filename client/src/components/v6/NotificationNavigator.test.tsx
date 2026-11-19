// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", navigate],
}));

import NotificationNavigator from "./NotificationNavigator";

type Listener = (event: MessageEvent) => void;
const listeners = new Set<Listener>();

describe("a clicked notification", () => {
  beforeEach(() => {
    listeners.clear();
    navigate.mockReset();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: (type: string, fn: Listener) => {
          if (type === "message") listeners.add(fn);
        },
        removeEventListener: (type: string, fn: Listener) => {
          if (type === "message") listeners.delete(fn);
        },
      },
    });
  });

  it("opens the conversation the notification names", () => {
    render(<NotificationNavigator />);
    const listener = [...listeners][0]!;
    listener({ data: { type: "navigate", url: "/chat/7" } } as MessageEvent);
    expect(navigate).toHaveBeenCalledWith("/chat/7");
  });

  it("does not follow a URL outside the app", () => {
    render(<NotificationNavigator />);
    const listener = [...listeners][0]!;
    listener({
      data: { type: "navigate", url: "https://example.com/chat/7" },
    } as MessageEvent);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("stops listening when the page goes away", () => {
    const view = render(<NotificationNavigator />);
    expect(listeners.size).toBe(1);
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
