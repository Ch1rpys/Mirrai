import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserLocale = vi.fn();
const getPersonasByUserId = vi.fn();

vi.mock("../db", () => ({
  getUserLocale: (...a: unknown[]) => getUserLocale(...a),
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
}));

import { handleCommand, resetCommandChains } from "./commands";

const ready = (id: number, name: string) => ({
  id,
  name,
  analysisStatus: "ready",
  graduationStatus: null,
});

describe("slash commands one at a time", () => {
  beforeEach(() => {
    resetCommandChains();
    getUserLocale.mockReset().mockResolvedValue("zh");
    getPersonasByUserId.mockReset();
  });

  it("does not let two commands read and change the same session at once", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    getPersonasByUserId
      .mockImplementationOnce(async () => {
        await gate;
        return [ready(1, "小A")];
      })
      .mockResolvedValue([ready(1, "小A")]);

    const first = handleCommand({
      userId: 1,
      conversationKey: "u1",
      text: "/使用 小A",
      defaultPersonaId: 1,
    });
    await vi.waitFor(() =>
      expect(getPersonasByUserId).toHaveBeenCalledTimes(1),
    );

    const second = handleCommand({
      userId: 1,
      conversationKey: "u1",
      text: "/使用 小A",
      defaultPersonaId: 1,
    });
    await Promise.resolve();
    expect(getPersonasByUserId).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toMatchObject({ handled: true });
    await expect(second).resolves.toMatchObject({ handled: true });
    expect(getPersonasByUserId).toHaveBeenCalledTimes(2);
  });
});
