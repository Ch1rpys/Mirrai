import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The uploads directory guard.
 *
 * Two things are checked here: the path decides whose file it is, and —
 * since C8.4 — a session the app lock covers cannot fetch the files
 * either. The lock screen is a screen; a photograph of the person is
 * one URL away.
 */

const authenticateRequest = vi.fn();
const userHasMessageWithMediaUrl = vi.fn();
const isPersonaSharedWithMember = vi.fn();

vi.mock("./auth", () => ({
  authenticateRequest: (...a: unknown[]) => authenticateRequest(...a),
}));

vi.mock("../db", () => ({
  userHasMessageWithMediaUrl: (...a: unknown[]) => userHasMessageWithMediaUrl(...a),
  isPersonaSharedWithMember: (...a: unknown[]) => isPersonaSharedWithMember(...a),
}));

import { isOwnedByUser, uploadsAuthGuard } from "./uploads";
import { noteUnlock, resetAppLockStore, sessionKeyFromCookieHeader } from "./app-lock";

/** Just enough of an express response for the guard. */
function fakeResponse() {
  return {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("isOwnedByUser", () => {
  it("allows a user their own uploaded persona file", () => {
    expect(isOwnedByUser("personas/1/2/a.png", 1)).toBe(true);
  });

  it("refuses another user's file", () => {
    expect(isOwnedByUser("personas/2/2/a.png", 1)).toBe(false);
  });

  it("allows a user their own chat media", () => {
    expect(isOwnedByUser("chat/1/2/abc.png", 1)).toBe(true);
    expect(isOwnedByUser("chat/2/2/abc.png", 1)).toBe(false);
  });

  it("allows a user their own speech", () => {
    expect(isOwnedByUser("tts/1/abcdef0123456789.mp3", 1)).toBe(true);
    expect(isOwnedByUser("tts/2/abcdef0123456789.mp3", 1)).toBe(false);
  });

  it("does not let the path decide who owns a legacy speech file", () => {
    // Files written before speech was scoped per user have no owner in
    // their path, and their names are the hash of the text they were
    // made from — so two people who asked for the same words share one
    // file. The path cannot say whose it is; the conversation can.
    expect(isOwnedByUser("tts/legacy/abcdef.mp3", 1)).toBe(false);
  });

  it("refuses an unknown scope", () => {
    expect(isOwnedByUser("secrets/1/a.txt", 1)).toBe(false);
  });

  it("refuses a key with too few segments", () => {
    expect(isOwnedByUser("personas", 1)).toBe(false);
    expect(isOwnedByUser("", 1)).toBe(false);
  });

  it("ignores a leading slash", () => {
    expect(isOwnedByUser("/personas/1/2/a.png", 1)).toBe(true);
  });
});

describe("uploadsAuthGuard and the app lock", () => {
  const lockedUser = {
    id: 1,
    lockSettings: { enabled: true, idleMinutes: 5, passkeys: [] },
  };
  const request = () => ({
    path: "/personas/1/2/a.png",
    headers: { cookie: "app_session_id=uploads-session" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetAppLockStore();
    authenticateRequest.mockResolvedValue(lockedUser);
    userHasMessageWithMediaUrl.mockResolvedValue(false);
    isPersonaSharedWithMember.mockResolvedValue(false);
  });

  it("refuses a locked session before it ever looks at the file", async () => {
    const response = fakeResponse();
    const next = vi.fn();
    uploadsAuthGuard(request() as never, response as never, next);
    await vi.waitFor(() => expect(response.statusCode).toBe(403));
    expect(response.body).toEqual({ error: "LOCKED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("serves the file again once the session has unlocked", async () => {
    await noteUnlock(
      { enabled: true, idleMinutes: 5, passkeys: [] },
      sessionKeyFromCookieHeader("app_session_id=uploads-session"),
    );
    const response = fakeResponse();
    const next = vi.fn();
    uploadsAuthGuard(request() as never, response as never, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(response.statusCode).toBe(0);
  });
});
