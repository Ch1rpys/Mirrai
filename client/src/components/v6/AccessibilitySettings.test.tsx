// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { ThemeProvider } from "@/contexts/ThemeContext";
import AccessibilitySettings from "./AccessibilitySettings";

/**
 * The accessibility panel.
 *
 * The three settings have to do something, not just be remembered: each one
 * becomes an attribute on `<html>`, which the stylesheet reads. And they have
 * to survive a reload, which means the provider applies the stored values on
 * mount rather than only when a control is clicked.
 */

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      translate("zh", key as never, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

/** The root's accessibility attributes, as the stylesheet would see them. */
function htmlAttributes() {
  const root = document.documentElement;
  return {
    fontScale: root.getAttribute("data-font-scale"),
    contrast: root.getAttribute("data-contrast"),
    reduceMotion: root.getAttribute("data-reduce-motion"),
  };
}

function renderPanel() {
  return render(
    <ThemeProvider defaultTheme="light" switchable>
      <AccessibilitySettings />
    </ThemeProvider>,
  );
}

describe("the accessibility panel", () => {
  beforeEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute("data-font-scale");
    root.removeAttribute("data-contrast");
    root.removeAttribute("data-reduce-motion");
  });

  it("offers the three font sizes and applies the chosen one to <html>", async () => {
    const user = userEvent.setup();
    renderPanel();

    // The default is the first of the three and is marked as pressed.
    expect(htmlAttributes().fontScale).toBe("1");
    expect(
      screen.getByRole("button", { name: translate("zh", "accessibility.fontScaleDefault") }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      screen.getByRole("button", { name: translate("zh", "accessibility.fontScaleLarge") }),
    );
    expect(htmlAttributes().fontScale).toBe("1.125");

    await user.click(
      screen.getByRole("button", { name: translate("zh", "accessibility.fontScaleLargest") }),
    );
    expect(htmlAttributes().fontScale).toBe("1.25");
  });

  it("applies high contrast to <html> and takes it away again", async () => {
    const user = userEvent.setup();
    renderPanel();
    const toggle = screen.getByRole("switch", {
      name: translate("zh", "accessibility.contrast"),
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(htmlAttributes().contrast).toBeNull();

    await user.click(toggle);
    expect(htmlAttributes().contrast).toBe("high");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    expect(htmlAttributes().contrast).toBeNull();
  });

  it("stops motion in the app", async () => {
    const user = userEvent.setup();
    renderPanel();
    const toggle = screen.getByRole("switch", {
      name: translate("zh", "accessibility.reduceMotion"),
    });
    expect(htmlAttributes().reduceMotion).toBeNull();

    await user.click(toggle);
    expect(htmlAttributes().reduceMotion).toBe("true");
  });

  it("keeps all three settings through a reload", async () => {
    const user = userEvent.setup();
    const first = renderPanel();
    await user.click(
      screen.getByRole("button", { name: translate("zh", "accessibility.fontScaleLarge") }),
    );
    await user.click(
      screen.getByRole("switch", { name: translate("zh", "accessibility.contrast") }),
    );
    await user.click(
      screen.getByRole("switch", { name: translate("zh", "accessibility.reduceMotion") }),
    );
    first.unmount();

    // A reload is a fresh document: the attributes are gone, and the stored
    // values are what has to bring them back.
    const root = document.documentElement;
    root.removeAttribute("data-font-scale");
    root.removeAttribute("data-contrast");
    root.removeAttribute("data-reduce-motion");

    renderPanel();
    expect(htmlAttributes()).toEqual({
      fontScale: "1.125",
      contrast: "high",
      reduceMotion: "true",
    });
  });

  it("ignores a stored value it does not understand", () => {
    localStorage.setItem(
      "mirrai-a11y",
      JSON.stringify({ fontScale: 3, contrast: "yes", reduceMotion: 1 }),
    );
    renderPanel();
    expect(htmlAttributes()).toEqual({
      fontScale: "1",
      contrast: null,
      reduceMotion: null,
    });
  });

  it("has a name on every control", () => {
    // The panel is part of the accessibility rule itself: a switch with no
    // name is a switch a screen-reader user cannot operate.
    renderPanel();
    const controls = [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("switch"),
    ];
    for (const control of controls) {
      expect(control).toHaveAccessibleName();
    }
  });
});
