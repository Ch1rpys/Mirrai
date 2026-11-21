import { useMemo } from "react";
import { useParams, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import InterviewView from "@/components/v6/InterviewView";

/**
 * The interview page (C1.8).
 *
 * Two addresses use the same page. `/persona/new/interview` creates a new
 * persona from what the person says; `/persona/:id/interview` describes a
 * persona that already exists but has no records yet.
 */
export default function Interview() {
  const params = useParams<{ id?: string }>();
  const search = useSearch();
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const { isAuthenticated, loading } = useAuth({ redirectOnUnauthenticated: true });

  const rawId = params.id;
  const personaId = rawId ? Number.parseInt(rawId, 10) : undefined;
  const hasPersonaId = typeof personaId === "number" && Number.isInteger(personaId) && personaId > 0;

  const persona = trpc.persona.get.useQuery(
    { id: hasPersonaId ? (personaId as number) : 0 },
    { enabled: isAuthenticated && hasPersonaId },
  );

  if (loading) return <PageLoader />;
  if (rawId && !hasPersonaId) return <NotFound />;
  if (hasPersonaId && persona.isLoading) return <PageLoader />;
  if (hasPersonaId && (persona.isError || !persona.data)) return <NotFound />;

  return (
    <InterviewView
      personaId={hasPersonaId ? (personaId as number) : undefined}
      personaName={hasPersonaId ? persona.data?.name : undefined}
      initialName={query.get("name") ?? ""}
    />
  );
}
