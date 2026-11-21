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
    const rows = (personas.data ?? []) as Array<{ id: number; locked?: boolean }>;
    const first = rows.find((row) => !row.locked);
    navigate(first ? `/chat/${first.id}` : "/", { replace: true });
  }, [personas.isLoading, personas.data, navigate]);

  return <PageLoader />;
}
