/**
 * Sending one channel reply, one bubble at a time.
 *
 * Kept apart from the bridge so a channel entry can use it without
 * pulling the conversation pipeline, and so the real function can be
 * tested at the entry that calls it.
 */
import { fallbackChannelGapMs, waitAbortable } from "../chat/inbox";

export interface ChannelReply {
  parts: string[];
  gapsMs: number[];
}

export async function sendChannelParts(
  reply: ChannelReply | null,
  send: (text: string) => Promise<unknown>,
): Promise<void> {
  if (!reply || reply.parts.length === 0) return;
  for (let i = 0; i < reply.parts.length; i++) {
    if (i > 0) {
      const gap = reply.gapsMs[i - 1] ?? fallbackChannelGapMs(reply.parts[i]!);
      if (gap > 0) await waitAbortable(gap);
    }
    await send(reply.parts[i]!);
  }
}
