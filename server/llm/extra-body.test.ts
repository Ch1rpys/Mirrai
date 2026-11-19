import { describe, expect, it } from "vitest";
import { EXTRA_BODY_MAX_BYTES, inspectExtraBody } from "./extra-body";

describe("inspectExtraBody", () => {
  it("accepts a small object", () => {
    expect(inspectExtraBody({ enable_thinking: false })).toEqual({
      ok: true,
      value: { enable_thinking: false },
    });
  });

  it("rejects extraBody larger than 2 KB", () => {
    const extraBody = { blob: "x".repeat(EXTRA_BODY_MAX_BYTES) };
    expect(inspectExtraBody(extraBody)).toEqual({ ok: false, error: "too_large" });
  });

  it("counts UTF-8 bytes, not characters", () => {
    const extraBody = { blob: "中".repeat(1000) };
    expect(JSON.stringify(extraBody).length).toBeLessThan(EXTRA_BODY_MAX_BYTES);
    expect(inspectExtraBody(extraBody)).toEqual({ ok: false, error: "too_large" });
  });

  it("rejects extraBody that names model", () => {
    expect(inspectExtraBody({ model: "other" })).toEqual({ ok: false, error: "forbidden" });
  });

  it("rejects a non-object", () => {
    expect(inspectExtraBody(["nope"])).toEqual({ ok: false, error: "not_object" });
  });
});
