import { describe, expect, it } from "vitest";
import { appendVideoMaterial } from "./video-materials";

describe("the video material in a distillation", () => {
  it("puts what was said inside a fence, under its own heading", () => {
    const out = appendVideoMaterial("观察卡", {
      transcripts: ["我昨天去了海边。", "下次带你去吃那家面。"],
      skipped: 0,
    }, "zh");
    expect(out).toContain("视频里说的话：");
    expect(out).toContain("MATERIAL>>>:");
    expect(out).toContain("我昨天去了海边。");
    expect(out).toContain("下次带你去吃那家面。");
    for (const line of ["我昨天去了海边。", "下次带你去吃那家面。"]) {
      const at = out.indexOf(line);
      const open = out.lastIndexOf("MATERIAL>>>:", at);
      const close = out.indexOf("<<<END MATERIAL", at);
      expect(open).toBeGreaterThanOrEqual(0);
      expect(at).toBeGreaterThan(open);
      expect(close).toBeGreaterThan(at);
    }
  });

  it("says how many videos were not read", () => {
    const out = appendVideoMaterial("", { transcripts: [], skipped: 1 }, "zh");
    expect(out).toContain("还有 1 个视频没有读");
    expect(out).toContain("最多读 4 个");
  });

  it("leaves the analysis untouched when there was nothing", () => {
    expect(appendVideoMaterial("观察卡", { transcripts: [], skipped: 0 }, "zh")).toBe("观察卡");
  });
});
