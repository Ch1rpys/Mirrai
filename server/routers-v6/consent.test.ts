import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { copy } from "@shared/copy";
import { hashConsentToken } from "../consent/link";

const getPersonaById = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();
const findPersonaByConsentTokenHash = vi.fn();
const purgePersona = vi.fn();
const createConsentRemoval = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPersonaSettings: (...a: unknown[]) => getPersonaSettings(...a),
  setPersonaSettings: (...a: unknown[]) => setPersonaSettings(...a),
  findPersonaByConsentTokenHash: (...a: unknown[]) => findPersonaByConsentTokenHash(...a),
  purgePersona: (...a: unknown[]) => purgePersona(...a),
  createConsentRemoval: (...a: unknown[]) => createConsentRemoval(...a),
}));

import { rateLimiter } from "../_core/rate-limit";
import { appRouter } from "../routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const persona = { id: 5, userId: 1, name: "小满" } as any;
const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

function linkSettings(overrides: Record<string, unknown> = {}) {
  return {
    consentLink: {
      tokenHash: hashConsentToken("a-token"),
      expiresAt: future,
      ...overrides,
    },
  };
}

async function rejected(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("the consent routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter.reset?.();
    getPersonaById.mockResolvedValue(persona);
    getPersonaSettings.mockResolvedValue(null);
    setPersonaSettings.mockResolvedValue(true);
    findPersonaByConsentTokenHash.mockResolvedValue(undefined);
    purgePersona.mockResolvedValue(undefined);
    createConsentRemoval.mockResolvedValue(undefined);
  });

  it("does not show somebody else's consent state", async () => {
    getPersonaById.mockResolvedValue(undefined);
    const error = await rejected(
      appRouter.createCaller(ctxFor(2)).consent.status({ personaId: 5 }),
    );
    expect(error.code).toBe("NOT_FOUND");
  });

  it("returns the current status and the link's dates, never the hash", async () => {
    getPersonaSettings.mockResolvedValue({
      consent: "asked_yes",
      consentLink: { tokenHash: "secret-hash", expiresAt: future, answeredAt: past },
    });
    const caller = appRouter.createCaller(ctxFor(1));
    const status = await caller.consent.status({ personaId: 5 });
    expect(status.consent).toBe("asked_yes");
    expect(status.link).toEqual({ expiresAt: future, answeredAt: past });
    expect(JSON.stringify(status)).not.toContain("secret-hash");
  });

  it("records a manual answer under the persona's data lock", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const result = await caller.consent.setStatus({ personaId: 5, consent: "asked_no" });
    expect(result.consent).toBe("asked_no");
    expect(setPersonaSettings).toHaveBeenCalledTimes(1);
    const [, , saved] = setPersonaSettings.mock.calls[0];
    expect(saved.consent).toBe("asked_no");
    // The write goes through `withPersonaDataLock`: the settings route is
    // the same one every other personaData write takes.
    expect(getPersonaById).toHaveBeenCalledWith(5, 1);
  });

  it("hands out a 32-byte link and stores only its hash", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const result = await caller.consent.createLink({ personaId: 5 });
    expect(result.path).toMatch(/^\/consent\/[0-9a-f]{64}$/);
    const token = result.path.split("/").pop()!;
    const [, , saved] = setPersonaSettings.mock.calls[0];
    expect(saved.consentLink.tokenHash).toBe(hashConsentToken(token));
    expect(saved.consentLink.tokenHash).not.toBe(token);
    const days = (new Date(saved.consentLink.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("exports a self-contained page with the persona's name", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const result = await caller.consent.exportPage({ personaId: 5 });
    expect(result.html).toContain("小满");
    expect(result.html).not.toMatch(/https?:\/\//);
  });

  it("answers an invalid, an expired and an answered token with the same 404", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const messages: string[] = [];

    const invalid = await rejected(caller.consent.getByToken({ token: "nope" }));
    expect(invalid.code).toBe("NOT_FOUND");
    messages.push(invalid.message);

    // Same hash, but the clock is past the expiry.
    findPersonaByConsentTokenHash.mockResolvedValue({
      ...persona,
      settings: linkSettings({ expiresAt: past }),
    });
    const expired = await rejected(caller.consent.getByToken({ token: "a-token" }));
    expect(expired.code).toBe("NOT_FOUND");
    messages.push(expired.message);

    // Already answered.
    findPersonaByConsentTokenHash.mockResolvedValue({
      ...persona,
      settings: linkSettings({ answeredAt: past }),
    });
    const answered = await rejected(caller.consent.getByToken({ token: "a-token" }));
    expect(answered.code).toBe("NOT_FOUND");
    messages.push(answered.message);

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(copy("zh", "errors.consentLinkInvalid"));
  });

  it("shows the modelled person's name and nothing else", async () => {
    findPersonaByConsentTokenHash.mockResolvedValue({
      ...persona,
      settings: linkSettings(),
    });
    const caller = appRouter.createCaller(ctxFor(1));
    const page = await caller.consent.getByToken({ token: "a-token" });
    expect(page).toEqual({ name: "小满" });
    expect(Object.keys(page)).toEqual(["name"]);
  });

  it("writes the answer once, under the lock", async () => {
    findPersonaByConsentTokenHash.mockResolvedValue({
      ...persona,
      settings: linkSettings(),
    });
    getPersonaSettings.mockResolvedValue(linkSettings());
    const caller = appRouter.createCaller(ctxFor(1));
    const result = await caller.consent.answer({ token: "a-token", answer: "no" });
    expect(result.consent).toBe("asked_no");
    const [, , saved] = setPersonaSettings.mock.calls[0];
    expect(saved.consent).toBe("asked_no");
    expect(saved.consentLink.answeredAt).toBeTruthy();
    // The hash and expiry survive the answer; a second click is refused
    // because `answeredAt` is set.
    expect(saved.consentLink.tokenHash).toBe(hashConsentToken("a-token"));
  });

  it("refuses a second answer on the same link", async () => {
    findPersonaByConsentTokenHash.mockResolvedValue({
      ...persona,
      settings: linkSettings({ answeredAt: past }),
    });
    getPersonaSettings.mockResolvedValue(linkSettings({ answeredAt: past }));
    const caller = appRouter.createCaller(ctxFor(1));
    const error = await rejected(caller.consent.answer({ token: "a-token", answer: "yes" }));
    expect(error.code).toBe("NOT_FOUND");
    expect(setPersonaSettings).not.toHaveBeenCalled();
  });

  it("deletes for good only when the typed name matches", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const wrong = await rejected(
      caller.persona.purgeForConsent({ personaId: 5, confirmName: "小满姐" }),
    );
    expect(wrong.code).toBe("BAD_REQUEST");
    expect(wrong.message).toBe(copy("zh", "errors.consentNameMismatch"));
    expect(purgePersona).not.toHaveBeenCalled();

    const result = await caller.persona.purgeForConsent({ personaId: 5, confirmName: "小满" });
    expect(result).toEqual({ removed: true });
    expect(purgePersona).toHaveBeenCalledWith(5, 1);
    expect(createConsentRemoval).toHaveBeenCalledWith(1);
  });
});
