import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import SealSettings from "@/components/v6/SealSettings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

/**
 * The controls for a sealed persona (C6.2).
 *
 * The seal itself is on the profile and graduation pages, and both of
 * them start by reading `persona.get` — which the seal refuses. So once
 * the persona was sealed there was nowhere left in the app to lift the
 * seal or delete the persona: the promise "you can always export or
 * delete it" had no button behind it. This page is that button. It
 * reads the exempt `persona.seal.status` route instead of the persona,
 * and it draws the same controls, plus the two ways out that the data
 * always has: take it with you, or delete it.
 */
export default function SealManage() {
  const params = useParams<{ id: string }>();
  const personaId = Number.parseInt(params.id ?? "", 10);
  const hasPersonaId = Number.isInteger(personaId) && personaId > 0;
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const { t } = useLocale();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = trpc.persona.seal.status.useQuery(
    { personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const remove = trpc.persona.delete.useMutation({
    onSuccess: () => {
      setConfirmDelete(false);
      navigate("/");
    },
    onError: (error: { message: string }) =>
      toast.error(t("lobby.deleteDialog.failed", { message: error.message })),
  });

  if (!hasPersonaId) return <NotFound />;

  if (authLoading || status.isLoading) return <PageLoader />;

  /**
   * A failed read is said, not drawn as a sealed persona.
   *
   * The page must not turn "could not read" into "still sealed": the
   * user would act on a state nobody checked.
   */
  if (status.isError || !status.data) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 app-header">
          <div className="container app-nav">
            <button onClick={() => navigate("/")} className="app-nav-back -ml-1 gap-1">
              <ArrowLeft className="w-4 h-4" /><span className="text-sm">{t("common.back")}</span>
            </button>
          </div>
        </header>
        <main className="container page-main max-w-2xl">
          <div className="text-center space-y-4 py-16">
            <p className="text-sm text-foreground/80">{t("seal.loadFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => status.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const data = status.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")} className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">{t("common.back")}</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div>
              <p className="kicker">{t("seal.title")}</p>
              <p className="app-nav-title">{data.name}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container page-main max-w-2xl space-y-5">
        <section className="surface p-5 sm:p-6 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">{t("seal.manageNote")}</p>
          <SealSettings personaId={personaId} />
        </section>

        <section className="surface p-5 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={() => navigate("/settings?tab=data")}
            >
              <Download className="w-3.5 h-3.5" /> {t("graduationPage.takeItWithYou")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-md text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-3.5 h-3.5" /> {t("seal.delete")}
            </Button>
          </div>
        </section>
      </main>

      <Dialog open={confirmDelete} onOpenChange={() => setConfirmDelete(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-foreground">
              {t("lobby.deleteDialog.title")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm py-2 leading-relaxed">
            {t("lobby.deleteDialog.bodyLead")}{" "}
            <span className="text-foreground font-medium">{data.name}</span>{" "}
            {t("lobby.deleteDialog.bodyTail")}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} className="rounded-md">
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="rounded-md"
              onClick={() => remove.mutate({ id: personaId })}
              disabled={remove.isPending}
            >
              {remove.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
