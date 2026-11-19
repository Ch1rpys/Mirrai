import { describe, expect, it, vi, beforeEach } from "vitest";

const set = vi.fn();
const connectRedis = vi.fn();

vi.mock("../_core/redis", () => ({
  connectRedis: (...a: unknown[]) => connectRedis(...a),
}));

import { claimSilenceNotice, resetSilenceNotices } from "./silence-notice";

describe("the once-a-day silence notice", () => {
  beforeEach(() => {
    resetSilenceNotices();
    set.mockReset();
    connectRedis.mockReset();
    connectRedis.mockResolvedValue(null);
  });

  it("lets the first claim through and refuses the second", async () => {
    expect(await claimSilenceNotice(1, 7, "2024-06-01")).toBe(true);
    expect(await claimSilenceNotice(1, 7, "2024-06-01")).toBe(false);
    expect(await claimSilenceNotice(1, 7, "2024-06-02")).toBe(true);
    expect(await claimSilenceNotice(2, 7, "2024-06-01")).toBe(true);
  });

  it("uses Redis when it is there", async () => {
    connectRedis.mockResolvedValue({ client: { set } });
    set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    expect(await claimSilenceNotice(1, 7, "2024-06-01")).toBe(true);
    expect(await claimSilenceNotice(1, 7, "2024-06-01")).toBe(false);
    expect(set).toHaveBeenCalledWith(
      "silence-notice:1:7:2024-06-01",
      "1",
      { NX: true, PX: 48 * 60 * 60_000 },
    );
  });
});
