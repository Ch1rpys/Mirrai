/**
 * One "they did not reply" notice per conversation per day.
 *
 * On a channel the notice is a real message. Sending it every time
 * they stayed quiet would fill the thread. Redis shares the mark
 * across processes; without it the mark lives in this process.
 */
import { connectRedis } from "../_core/redis";

const memory = new Map<string, number>();
const TTL_MS = 48 * 60 * 60_000;

function keyOf(userId: number, personaId: number, day: string): string {
  return `silence-notice:${userId}:${personaId}:${day}`;
}

export function resetSilenceNotices(): void {
  memory.clear();
}

/**
 * Claims the day's silence notice for this conversation.
 *
 * Returns true the first time; later calls the same day return false.
 */
export async function claimSilenceNotice(
  userId: number,
  personaId: number,
  day: string,
): Promise<boolean> {
  const key = keyOf(userId, personaId, day);
  try {
    const redis = await connectRedis();
    if (redis) {
      const taken = await redis.client.set(key, "1", { NX: true, PX: TTL_MS });
      return taken === "OK";
    }
  } catch (error) {
    console.warn("[Silence] The shared store could not be reached:", error);
  }
  const now = Date.now();
  const until = memory.get(key);
  if (until != null && until > now) return false;
  memory.set(key, now + TTL_MS);
  return true;
}
