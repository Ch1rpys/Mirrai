import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import PageLoader from "@/components/PageLoader";

/**
 * `/chat/last` — back to the conversation you were in (C8.8).
 *
 * The PWA's shortcut cannot know which persona that is: it is a static
 * URL. So it lands here, and the app decides — the persona list is
 * already sorted with the most recently touched first. A locked persona
 * is skipped: its chat would only show the PIN gate.
 */
export default function ChatLast() {
  const [, navigate] = useLocation();
  const personas = trpc.persona.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (personas.isLoading) return;
    const rows = (personas.data ?? []) as Array<{
      id: number;
      locked?: boolean;
      lastChatAt?: Date | string | null;
      updatedAt?: Date | string | null;
    }>;
    /**
     * "Last" means the last *conversation*, not the last edit.
     *
     * `persona.list` is ordered by `updatedAt`, which only moves when the
     * persona row itself is written — a persona that was edited
     * yesterday but talked to this morning would sort ahead of one that
     * talked ten minutes ago. The chat times are the ones that mean
     * "the conversation you were in".
     */
    const when = (row: { lastChatAt?: Date | string | null; updatedAt?: Date | string | null }) => {
      const value = row.lastChatAt ?? row.updatedAt ?? null;
      const at = value instanceof Date ? value.getTime() : value ? new Date(value).getTime() : 0;
      return Number.isFinite(at) ? at : 0;
    };
    const sorted = [...rows].sort((a, b) => when(b) - when(a));
    const first = sorted.find((row) => !row.locked);
    navigate(first ? `/chat/${first.id}` : "/", { replace: true });
  }, [personas.isLoading, personas.data, navigate]);

  return <PageLoader />;
}
