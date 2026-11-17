import { describe, expect, it, vi } from "vitest";
import { confirmHarmFromRecords } from "./harm";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";

describe("confirming harm in the records", () => {
  it("writes a pending belittle report when the model confirms all five", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify([0, 1, 2, 3, 4].map((i) => ({ i, harm: true }))),
    );
    const report = await confirmHarmFromRecords({
      records: buildXiaomanRecords({ withHarm: true }),
      locale: "zh",
      invoke,
    });
    expect(invoke).toHaveBeenCalled();
    expect(report?.decision).toBe("pending");
    expect(report?.categories).toHaveLength(1);
    expect(report?.categories[0]?.kind).toBe("belittle");
    expect(report?.categories[0]?.count).toBe(5);
    expect(report?.categories[0]?.examples).toHaveLength(3);
  });

  it("does not write a report for the default log", async () => {
    const invoke = vi.fn();
    const report = await confirmHarmFromRecords({
      records: buildXiaomanRecords(),
      invoke,
    });
    expect(report).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("drops a kind the model rejects", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify([0, 1, 2, 3, 4].map((i) => ({ i, harm: false }))),
    );
    const report = await confirmHarmFromRecords({
      records: buildXiaomanRecords({ withHarm: true }),
      invoke,
    });
    expect(report).toBeNull();
  });
});
