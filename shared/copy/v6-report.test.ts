import { describe, expect, it } from "vitest";
import { zh, en } from "../../client/src/i18n";
import { V6 } from "./v6";

/**
 * The words of the look-back pages (WP11).
 *
 * The page states what was counted. It does not score the relationship,
 * rank the years, or grade the person — and neither do its labels.
 */
const BANNED = /得分|评分|指数|排名|等级|\bscore\b|\brating\b|\brank\b/i;

function leaves(value: unknown, prefix = ""): Array<{ key: string; text: string }> {
  if (typeof value === "string") return [{ key: prefix, text: value }];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

function reportEntries(dictionary: Record<string, unknown>) {
  return leaves(dictionary).filter(
    (entry) => entry.key.startsWith("report.") || entry.key.startsWith("records."),
  );
}

describe("the look-back copy", () => {
  it("never scores, ranks or grades anything", () => {
    for (const [language, dictionary] of [["zh", zh], ["en", en]] as const) {
      const offenders = reportEntries(dictionary as never).filter((entry) =>
        BANNED.test(entry.text) || BANNED.test(entry.key),
      );
      expect(offenders, `${language} copy uses a scoring word`).toEqual([]);
    }
  });

  it("keeps the wellbeing and graduation copy free of scores too", () => {
    // The look-back test was built in WP11. The two new namespaces say
    // facts about feelings — "how you have been" and why a goodbye is
    // suggested — and they must not turn into a score either.
    for (const [language, dictionary] of [["zh", zh], ["en", en]] as const) {
      const offenders = leaves(dictionary as never).filter(
        (entry) =>
          (entry.key.startsWith("wellbeing.") || entry.key.startsWith("graduationReasons.")) &&
          (BANNED.test(entry.text) || BANNED.test(entry.key)),
      );
      expect(offenders, `${language} copy uses a scoring word`).toEqual([]);
    }
  });

  it("keeps the server-side words of this package clean too", () => {
    const offenders = leaves(V6).filter(
      (entry) => BANNED.test(entry.text) || BANNED.test(entry.key),
    );
    expect(offenders).toEqual([]);
  });

  it("finds the entries it is supposed to look at", () => {
    expect(reportEntries(zh as never).length).toBeGreaterThan(40);
    expect(reportEntries(en as never).length).toBeGreaterThan(40);
  });
});
