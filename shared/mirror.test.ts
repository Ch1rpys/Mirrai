import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { splitScenes } from "./scenes";
import { measureMirror } from "./mirror";
import { buildSystemPrompt } from "../server/_core/persona-utils";

/**
 * The mirror (C4.1).
 *
 * The fixture is designed, so the answers are known: "嗯" is the short
 * reply that starts most of the conflicts, four of the six fights were
 * repaired by them, and every scene has one opening line.
 */
function rows() {
  return buildXiaomanRecords().map((record) => ({
    id: record.id,
    role: record.role,
    content: record.content,
    timestamp: record.timestamp,
    kind: record.kind,
    // B1.5 writes the state onto the column; the fixture knows it.
    emotion: record.role === "assistant" ? record.truth.state : null,
  }));
}

describe("measureMirror", () => {
  it("finds the short reply that starts the fights", () => {
    const mirror = measureMirror(rows(), { personaTimeZone: "Asia/Shanghai" });
    expect(mirror).not.toBeNull();
    const uh = mirror!.shortReplies.find((entry) => entry.text === "嗯");
    expect(uh).toBeDefined();
    expect(uh!.n).toBeGreaterThanOrEqual(6);
    expect(uh!.nextState.distant ?? 0).toBeGreaterThanOrEqual(6);
    expect(uh!.exampleIds.length).toBeGreaterThan(0);
  });

  it("counts who repairs first from the episodes", () => {
    const mirror = measureMirror(rows(), { personaTimeZone: "Asia/Shanghai" });
    expect(mirror!.repairBy).toEqual({ me: 2, them: 4 });
  });

  it("counts one opening per scene", () => {
    const labelled = rows();
    const scenes = splitScenes(labelled as never);
    const mirror = measureMirror(labelled, { personaTimeZone: "Asia/Shanghai" });
    expect(mirror!.starts.me + mirror!.starts.them).toBe(scenes.length);
  });

  it("has a delay measured with the roles swapped", () => {
    const mirror = measureMirror(rows(), { personaTimeZone: "Asia/Shanghai" });
    expect(mirror!.myDelay?.samples ?? 0).toBeGreaterThan(30);
    expect(mirror!.myDelayExampleIds.length).toBeGreaterThan(0);
  });

  it("carries an example line for every block", () => {
    const labelled = rows();
    const scenes = splitScenes(labelled as never);
    const mirror = measureMirror(labelled, { personaTimeZone: "Asia/Shanghai" });
    expect(mirror!.repairExampleIds.length).toBeGreaterThan(0);
    expect(mirror!.startExampleIds.length).toBe(scenes.length);
  });

  it("is absent when the record is too short", () => {
    expect(measureMirror(rows().slice(0, 30))).toBeNull();
  });

  it("never reaches the prompt", () => {
    const persona = {
      id: 1,
      userId: 1,
      name: "小A",
      emotionalState: "warm",
      timezone: "Asia/Shanghai",
      relationshipDesc: "恋人",
      togetherFrom: "2021-06-15",
      togetherTo: null,
      personaData: {},
      styleProfile: {
        mirror: {
          shortReplies: [{ text: "独一无二的镜子句子", n: 10, nextState: {}, nextGapMedianSec: 30, exampleIds: [] }],
          goingShort: { episodes: 1, byBand: {}, exampleIds: [] },
          myDelay: null,
          repairBy: { me: 1, them: 2 },
          starts: { me: 3, them: 4 },
        },
      },
    } as any;
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).not.toContain("独一无二的镜子句子");
    expect(prompt).not.toContain("repairBy");
  });
});
