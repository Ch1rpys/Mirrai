import { describe, expect, it } from "vitest";
import {
  deletePushSubscription,
  listPushSubscriptions,
  upsertPushSubscription,
} from "./db";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("push subscriptions in postgres", () => {
  it("updates the same endpoint instead of inserting another row", async () => {
    const userId = 9_960_000 + Math.floor(Math.random() * 10_000);
    const endpoint = `https://push.example/${userId}`;
    try {
      await upsertPushSubscription(userId, {
        endpoint,
        p256dh: "first",
        auth: "a1",
        userAgent: "one",
      });
      await upsertPushSubscription(userId, {
        endpoint,
        p256dh: "second",
        auth: "a2",
        userAgent: "two",
      });
      const rows = await listPushSubscriptions(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.p256dh).toBe("second");
      expect(rows[0]?.auth).toBe("a2");
    } finally {
      await deletePushSubscription(userId, endpoint);
    }
  });

  it("does not list or delete somebody else's subscription", async () => {
    const owner = 9_970_000 + Math.floor(Math.random() * 10_000);
    const other = owner + 50_000;
    const endpoint = `https://push.example/owned-${owner}`;
    try {
      await upsertPushSubscription(owner, {
        endpoint,
        p256dh: "secret",
        auth: "secret-auth",
        userAgent: null,
      });
      expect(await listPushSubscriptions(other)).toEqual([]);
      expect(await deletePushSubscription(other, endpoint)).toBe(false);
      const still = await listPushSubscriptions(owner);
      expect(still).toHaveLength(1);
      expect(still[0]?.p256dh).toBe("secret");
    } finally {
      await deletePushSubscription(owner, endpoint);
    }
  });
});
