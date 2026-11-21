/**
 * Accepting a shared persona (C7.2).
 *
 * The page shows only the owner's name and the persona's name before
 * the invitation is accepted. Accepting creates the member's own row;
 * their conversations afterwards are theirs.
 */
import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import PageLoader from "@/components/PageLoader";
import { getLoginUrl } from "@/const";

export default function ShareAccept() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [, navigate] = useLocation();
  const { t } = useLocale();
  const { isAuthenticated, loading } = useAuth();
  const preview = trpc.share.preview.useQuery({ token }, { enabled: token.length > 0 });
  /**
   * The page is read before the invitation is accepted, so it is
   * reachable without a login and carries a bearer token (§3.7). It must
   * not end up in a search index.
   */
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
  const accept = trpc.share.accept.useMutation({
    onSuccess: (data: { personaId: number }) => navigate(`/chat/${data.personaId}`),
  });

  if (loading || preview.isLoading) return <PageLoader />;
  if (preview.isError || !preview.data) {
    return (
      <main className="container page-main max-w-md">
        <p className="text-sm text-muted-foreground">{t("share.invalid")}</p>
      </main>
    );
  }

  return (
    <main className="container page-main max-w-md space-y-5">
      <h1 className="page-title">
        {t("share.acceptTitle", {
          owner: preview.data.ownerName,
          name: preview.data.personaName,
        })}
      </h1>
      {accept.isError && (
        <p className="text-sm text-destructive">{(accept.error as any)?.message ?? ""}</p>
      )}
      {isAuthenticated ? (
        <Button
          disabled={accept.isPending}
          onClick={() => accept.mutate({ token })}
        >
          {t("share.accept")}
        </Button>
      ) : (
        <Button onClick={() => { window.location.href = getLoginUrl(); }}>
          {t("share.signInFirst")}
        </Button>
      )}
    </main>
  );
}
