import { describe, expect, it } from "vitest";
import { commitDistilledPersona } from "./skill-engine/commit-distillation";
import {
  MAX_PERSONA_VERSIONS,
  createPersona,
  createPersonaVersion,
  purgePersona,
  getPersonaById,
  getPersonaVersion,
  listPersonaVersions,
} from "./db";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("persona versions", () => {
  it("stores the persona from before a distillation write and from after it", async () => {
    const userId = 9_940_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({
      userId,
      name: "versions-distill",
      personaData: { speakingStyle: "短句" },
    });
    try {
      await commitDistilledPersona(personaId, userId, {
        personaData: { speakingStyle: "更短" },
      });

      const versions = await listPersonaVersions(personaId, userId);
      expect(versions).toHaveLength(2);
      expect(versions.every((row) => row.reason === "distill")).toBe(true);
      expect((versions[0]?.personaData as { speakingStyle?: string } | null)?.speakingStyle).toBe("更短");
      expect((versions[1]?.personaData as { speakingStyle?: string } | null)?.speakingStyle).toBe("短句");
      expect(
        ((await getPersonaById(personaId, userId))?.personaData as { speakingStyle?: string } | null)
          ?.speakingStyle,
      ).toBe("更短");
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("drops the oldest version once twenty-one are stored", async () => {
    const userId = 9_950_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "versions-prune" });
    try {
      const ids: number[] = [];
      for (let n = 0; n < MAX_PERSONA_VERSIONS + 1; n++) {
        const id = await createPersonaVersion(personaId, userId, "edit");
        expect(id).toBeTypeOf("number");
        ids.push(id as number);
      }
      const oldest = ids[0];
      const versions = await listPersonaVersions(personaId, userId);
      expect(versions).toHaveLength(MAX_PERSONA_VERSIONS);
      expect(versions.map((row) => row.id)).not.toContain(oldest);
      expect(await getPersonaVersion(oldest, userId)).toBeUndefined();
      expect(versions[0]?.id).toBe(ids[ids.length - 1]);
    } finally {
      await purgePersona(personaId, userId);
    }
  });
});
