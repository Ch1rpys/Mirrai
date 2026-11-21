import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import { FileText, Share2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  clearShareInbox,
  importSharedFile,
  listSharedFiles,
  shareInboxSupported,
  type SharedFile,
} from "@/lib/share-inbox";

/**
 * The files shared into the app from somewhere else (C8.8).
 *
 * On a phone or a desktop that installs the PWA, "Share → Mirrai" posts
 * the file to the worker; this page is where it lands. Pick a persona,
 * import, and the wizard for identifying the format and the speakers
 * opens next — the same path as choosing the file by hand.
 *
 * The page deletes what it does not import as it goes away: a file the
 * user chose to share once should not stay in the browser.
 */
export default function ShareInbox() {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const selectId = useId();
  const supported = shareInboxSupported();
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [personaId, setPersonaId] = useState<number | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const alive = useRef(true);

  const personas = trpc.persona.list.useQuery(undefined, { enabled: supported });
  const available = (personas.data ?? []).filter(
    (persona) => !(persona as { locked?: boolean }).locked,
  );

  async function refresh() {
    setFailed(false);
    try {
      const found = await listSharedFiles();
      if (alive.current) setFiles(found);
    } catch {
      if (alive.current) {
        setFiles([]);
        setFailed(true);
      }
    }
  }

  useEffect(() => {
    alive.current = true;
    if (supported) void refresh();
    return () => {
      alive.current = false;
      /**
       * Unmounting is either "the user is done here" or "the import was
       * accepted and the wizard is opening" — in both cases the files
       * that are left were not imported, and they go.
       */
      void clearShareInbox().catch(() => {});
    };
  }, [supported]);

  async function onImport(file: SharedFile) {
    if (personaId === null || importing) return;
    setImporting(file.key);
    try {
      const result = await importSharedFile(file, personaId);
      const remaining = (files ?? []).filter((entry) => entry.key !== file.key);
      setFiles(remaining);
      navigate(`/upload/${result.fileId}`);
    } catch (error) {
      toast.error(t("shareInbox.importFailed", { message: (error as Error).message }));
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="container page-main flex-1 max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <Share2 className="w-4 h-4 text-foreground/70" aria-hidden="true" />
          <h1 className="page-title">{t("shareInbox.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          {t("shareInbox.description")}
        </p>

        {!supported ? (
          <p className="surface p-5 text-sm text-foreground/85">{t("shareInbox.unsupported")}</p>
        ) : failed ? (
          <div className="surface p-5 space-y-3">
            <p className="text-sm text-foreground/85">{t("shareInbox.failed")}</p>
            <Button variant="outline" className="rounded-md bg-transparent" onClick={() => void refresh()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : files === null ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : files.length === 0 ? (
          <div className="surface p-5">
            <p className="text-sm font-medium text-foreground">{t("shareInbox.empty")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("shareInbox.emptyHint")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="surface p-5 space-y-4">
              <div>
                <label htmlFor={selectId} className="text-sm text-foreground/80">
                  {t("shareInbox.pickPersona")}
                </label>
                <select
                  id={selectId}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={personaId ?? ""}
                  onChange={(event) => setPersonaId(Number(event.target.value) || null)}
                >
                  <option value="">—</option>
                  {available.map((persona: { id: number; name: string }) => (
                    <option key={persona.id} value={persona.id}>
                      {persona.name}
                    </option>
                  ))}
                </select>
              </div>
              {available.length === 0 && (
                <div className="flex items-center gap-3">
                  <p className="text-xs text-muted-foreground">{t("shareInbox.noPersonas")}</p>
                  <Button variant="outline" className="rounded-md bg-transparent" onClick={() => navigate("/onboarding")}>
                    {t("shareInbox.createPersona")}
                  </Button>
                </div>
              )}
              <ul className="space-y-2">
                {files.map((file) => (
                  <li key={file.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 min-w-0 text-sm text-foreground/85">
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{file.name}</span>
                    </span>
                    <Button
                      size="sm"
                      className="rounded-md flex-shrink-0"
                      disabled={personaId === null || importing !== null}
                      onClick={() => void onImport(file)}
                      aria-label={t("shareInbox.import")}
                    >
                      {importing === file.key ? t("shareInbox.importing") : t("shareInbox.import")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">{t("shareInbox.leaveClears")}</p>
          </div>
        )}
      </main>
    </div>
  );
}
