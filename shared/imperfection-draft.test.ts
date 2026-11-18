import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { measureFingerprint, type FingerprintRow } from "./style-fingerprint";
import { draftImperfection } from "./imperfection-draft";

function fixtureRows(): FingerprintRow[] {
  return buildXiaomanRecords().map((row, index) => ({
    id: index + 1,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
  }));
}

describe("draftImperfection", () => {
  it("drafts a short distant state that ends on a period, and leaves warm alone", () => {
    const rows = fixtureRows();
    const fingerprint = measureFingerprint(rows, { addressForms: ["陈树", "树树"] });
    const drafts = draftImperfection({ fingerprint }, { locale: "zh", rows });
    const distant = (drafts.distant ?? []).map((row) => row.text);
    expect(distant.some((text) => text.includes("话很短"))).toBe(true);
    expect(distant.some((text) => text.includes("句末带句号"))).toBe(true);
    expect(drafts.warm).toBeUndefined();
  });
});
