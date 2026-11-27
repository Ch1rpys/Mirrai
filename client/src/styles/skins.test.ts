import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The skins are neutral layouts, not copies (B7.15).
 *
 * The two IM layouts exist to feel familiar. Naming a real product — or
 * borrowing its icons and trademarks — would make the app a counterfeit
 * of something it is not. The names stay descriptive: green bubbles,
 * blue bubbles.
 */
const BANNED = [
  "微信",
  "wechat",
  "weixin",
  "imessage",
  "telegram",
  "whatsapp",
  "qq",
  "line",
];

const ROOT = path.resolve(__dirname, "..", "..");

describe("the chat skins", () => {
  it("give the two IM layouts their own bubble width (B7.15)", () => {
    // The manual lists the bubble's maximum width among the things a
    // skin changes; the stylesheet only changed colours and corners.
    const css = readFileSync(path.join(ROOT, "src/styles/skins.css"), "utf8");
    expect(css).toMatch(
      /\.chat-root\[data-skin="im-green"\] \.message-bubble-column[\s\S]*?max-width:/,
    );
    expect(css).toMatch(
      /\.chat-root\[data-skin="im-blue"\] \.message-bubble-column[\s\S]*?max-width:/,
    );
    // The classic layout keeps the width the app has always had.
    expect(css).not.toMatch(/data-skin="classic"[^}]*message-bubble-column/);
  });

  it("do not name another chat product", () => {
    const sources = [
      readFileSync(path.join(ROOT, "src/styles/skins.css"), "utf8"),
      readFileSync(path.join(ROOT, "src/components/v6/SkinPicker.tsx"), "utf8"),
    ].join("\n");
    const lower = sources.toLowerCase();
    const found = BANNED.filter((name) =>
      /^[\x00-\x7f]+$/.test(name)
        ? new RegExp(`\\b${name}\\b`).test(lower)
        : lower.includes(name),
    );
    expect(found).toEqual([]);
  });
});
