import { describe, expect, it, vi } from "vitest";

/**
 * The harm report's evidence lines stay in the card (C10.1).
 *
 * The snippets are the hurtful sentences themselves, kept so the user can
 * recognise what the app found — at most three, shown only on the notice.
 * They are not part of "my data" in the sense the export promises: an
 * exported file can be sent anywhere. The decision the user made and the
 * counts stay, because they are what the distillation reads next time.
 */
const harmReport = vi.hoisted(() => ({
  categories: [{
    kind: "belittle",
    count: 5,
    examples: [1, 2, 3],
    snippets: ["你就是个废物", "真没用"],
  }],
  decision: "remove",
}));

vi.mock("./db", () => ({
  getUserById: vi.fn().mockResolvedValue({
    id: 1,
    username: "someone",
    name: "小张",
    email: undefined,
    timezone: "Asia/Shanghai",
    addressStyle: undefined,
    boundaries: undefined,
    createdAt: new Date("2025-01-01T00:00:00Z"),
  }),
  getUserLocale: vi.fn().mockResolvedValue("zh"),
  getPersonasByUserId: vi.fn().mockResolvedValue([{
    id: 5,
    userId: 1,
    name: "小A",
    relationshipDesc: "朋友",
    togetherFrom: null,
    togetherTo: null,
    emotionalState: "warm",
    personaData: { personality: "温柔", harmReport },
    graduationStatus: null,
    graduatedAt: null,
    farewellLetter: null,
    presence: "active",
    timezone: null,
  }]),
  getUserMoods: vi.fn().mockResolvedValue([]),
  getUserJournal: vi.fn().mockResolvedValue([]),
  getMessagesByPersonaId: vi.fn().mockResolvedValue([]),
  getMemoriesByPersonaId: vi.fn().mockResolvedValue([]),
  getDiaryEntries: vi.fn().mockResolvedValue([]),
  getEmotionSnapshots: vi.fn().mockResolvedValue([]),
  getRelationshipEvents: vi.fn().mockResolvedValue([]),
  getLetters: vi.fn().mockResolvedValue([]),
  listFidelityRewritePairs: vi.fn().mockResolvedValue([]),
  getIntimacyData: vi.fn().mockResolvedValue({}),
}));

import { buildExportBundle, exportAsJson } from "./_core/export-data";

describe("the data export and the harm report (C10.1)", () => {
  it("keeps the decision and the counts, not the sentences", async () => {
    const bundle = await buildExportBundle(1);
    expect(bundle).not.toBeNull();
    const json = exportAsJson(bundle!);
    expect(json).not.toContain("你就是个废物");
    expect(json).not.toContain("真没用");
    expect(json).toContain('"decision": "remove"');
    const persona = bundle!.personas[0] as unknown as {
      personaData: { harmReport?: { decision?: string; categories?: Array<{ count?: number; snippets?: unknown }> } };
    };
    expect(persona.personaData.harmReport?.decision).toBe("remove");
    expect(persona.personaData.harmReport?.categories?.[0]?.count).toBe(5);
    expect(persona.personaData.harmReport?.categories?.[0]?.snippets).toBeUndefined();
  });
});
