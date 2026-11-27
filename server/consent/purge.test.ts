import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@shared/copy";
import { purgeForConsent, type PurgeForConsentDeps } from "./purge";

const getPersonaById = vi.fn();
const purgePersona = vi.fn();
const createConsentRemoval = vi.fn();

function deps(): PurgeForConsentDeps {
  return {
    getPersonaById: getPersonaById as unknown as PurgeForConsentDeps["getPersonaById"],
    purgePersona: purgePersona as unknown as PurgeForConsentDeps["purgePersona"],
    createConsentRemoval: createConsentRemoval as unknown as PurgeForConsentDeps["createConsentRemoval"],
    locale: "zh",
  };
}

describe("removing a persona because the other person said no", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    purgePersona.mockResolvedValue(undefined);
    createConsentRemoval.mockResolvedValue(undefined);
  });

  it("refuses when somebody else's persona is asked for", async () => {
    getPersonaById.mockResolvedValue(undefined);
    const outcome = await purgeForConsent(
      { personaId: 5, userId: 2, confirmName: "小满" },
      deps(),
    );
    expect(outcome.status).toBe("not_found");
    expect(purgePersona).not.toHaveBeenCalled();
    expect(createConsentRemoval).not.toHaveBeenCalled();
  });

  it("refuses a name that does not match, and deletes nothing", async () => {
    const outcome = await purgeForConsent(
      { personaId: 5, userId: 1, confirmName: "小满姐" },
      deps(),
    );
    expect(outcome.status).toBe("name_mismatch");
    expect(outcome.message).toBe(copy("zh", "errors.consentNameMismatch"));
    expect(purgePersona).not.toHaveBeenCalled();
    expect(createConsentRemoval).not.toHaveBeenCalled();
  });

  it("refuses an empty confirmation", async () => {
    const outcome = await purgeForConsent(
      { personaId: 5, userId: 1, confirmName: "   " },
      deps(),
    );
    expect(outcome.status).toBe("name_mismatch");
    expect(purgePersona).not.toHaveBeenCalled();
  });

  it("hard-deletes and leaves one content-free tombstone", async () => {
    const outcome = await purgeForConsent(
      { personaId: 5, userId: 1, confirmName: " 小满 " },
      deps(),
    );
    expect(outcome.status).toBe("removed");
    expect(purgePersona).toHaveBeenCalledWith(5, 1);
    expect(createConsentRemoval).toHaveBeenCalledWith(1);
    // The tombstone carries no persona id and no name.
    expect(createConsentRemoval.mock.calls[0]).toEqual([1]);
  });
});
