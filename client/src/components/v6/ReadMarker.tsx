import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Tells the server the conversation is in front of the user (C8.2).
 *
 * The mailbox counts a reply as unseen when it arrived after the last
 * time the user had the conversation open. So the chat page says when
 * it is visible: on mount, when the window comes back, and when a new
 * message lands while the user is looking at it. A reply that arrives
 * while they are reading is not something they missed.
 *
 * It renders nothing; it is the write half of "read".
 */
export default function ReadMarker({
  personaId,
  latestMessageId,
}: {
  personaId: number;
  /** The newest message on screen; a new one means the page is live. */
  latestMessageId?: number | string;
}) {
  const utils = trpc.useUtils();
  const markRead = trpc.chat.markRead.useMutation({
    onSuccess: () => {
      utils.letter.unreadCount.invalidate();
      utils.letter.inbox.invalidate();
    },
  });
  const { mutate } = markRead;

  useEffect(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    mutate({ personaId });
  }, [personaId, latestMessageId, mutate]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") mutate({ personaId });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [personaId, mutate]);

  return null;
}
