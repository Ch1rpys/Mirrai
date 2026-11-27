import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * One persona in one file (C9.5).
 *
 * Export writes a `.mirrai-persona` file — a copy for another machine, or
 * a keep-sake. Import always creates a **new** persona: the file's ids are
 * the file's, and the imported rows get new ones.
 *
 * The file can carry real chat records, so the panel says so, and a
 * passphrase is offered (and needed to read the file again).
 */
function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  // The real name is RFC 5987-encoded, because a header cannot hold raw
  // UTF-8; the plain `filename=` is the ASCII fallback.
  const extended = /filename\*=UTF-8''([^;]+)/.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Fall through to the plain form.
    }
  }
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : null;
}

const PASSPHRASE_HEADER = "x-mirrai-bundle-passphrase";

function encodePassphrase(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function PersonaBundle() {
  const { t } = useLocale();
  const personas = trpc.persona.list.useQuery();
  const [personaId, setPersonaId] = useState<number | null>(null);
  const [include, setInclude] = useState({ memories: true, records: true, conversation: false });
  const [passphrase, setPassphrase] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importPassphrase, setImportPassphrase] = useState("");

  const options = useMemo(
    () => (personas.data ?? []).filter((persona) => !(persona as { locked?: boolean }).locked),
    [personas.data],
  );
  const chosen = personaId ?? options[0]?.id ?? null;

  async function onExport() {
    if (chosen == null || exporting) return;
    setExporting(true);
    try {
      const response = await fetch("/api/persona/bundle", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: chosen,
          include,
          passphrase: passphrase.trim() ? passphrase.trim() : null,
        }),
      });
      if (!response.ok) {
        let message: string = t("bundle.exportFailed");
        try {
          const body = (await response.json()) as { error?: unknown };
          if (typeof body?.error === "string" && body.error) message = body.error;
        } catch {
          // A failure without a JSON body still has the fallback sentence.
        }
        toast.error(message);
        return;
      }
      const blob = await response.blob();
      const fileName =
        fileNameFromDisposition(response.headers.get("content-disposition")) ??
        "mirrai-persona.mirrai-persona";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("bundle.exported"));
    } catch (error) {
      toast.error(t("bundle.exportFailedWith", {
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setExporting(false);
    }
  }

  async function onImport() {
    if (!file || importing) return;
    setImporting(true);
    try {
      const response = await fetch("/api/persona/import-bundle", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(importPassphrase.trim()
            ? { [PASSPHRASE_HEADER]: encodePassphrase(importPassphrase.trim()) }
            : {}),
        },
        body: file,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        name?: unknown;
        counts?: { records?: number; memories?: number };
      };
      if (!response.ok) {
        toast.error(typeof body.error === "string" ? body.error : t("bundle.importFailed"));
        return;
      }
      toast.success(t("bundle.imported", {
        name: typeof body.name === "string" ? body.name : "",
        records: body.counts?.records ?? 0,
        memories: body.counts?.memories ?? 0,
      }));
      setFile(null);
      setImportPassphrase("");
      await personas.refetch();
    } catch (error) {
      toast.error(t("bundle.importFailedWith", {
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="section-title">{t("bundle.title")}</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("bundle.note")}</p>
      </div>

      {personas.isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {personas.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">{t("bundle.loadFailed")}</p>
          <Button size="sm" variant="ghost" onClick={() => void personas.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="bundle-persona">{t("bundle.personaLabel")}</label>
          <select
            id="bundle-persona"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={chosen ?? ""}
            onChange={(event) => setPersonaId(Number(event.target.value) || null)}
          >
            {options.map((persona: { id: number; name: string }) => (
              <option key={persona.id} value={persona.id}>{persona.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={include.memories}
              onChange={(event) => setInclude((prev) => ({ ...prev, memories: event.target.checked }))}
            />
            {t("bundle.includeMemories")}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={include.records}
              onChange={(event) => setInclude((prev) => ({ ...prev, records: event.target.checked }))}
            />
            {t("bundle.includeRecords")}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={include.conversation}
              onChange={(event) => setInclude((prev) => ({ ...prev, conversation: event.target.checked }))}
            />
            {t("bundle.includeConversation")}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="bundle-passphrase">{t("bundle.passphraseLabel")}</label>
          <input
            id="bundle-passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            maxLength={1024}
            placeholder={t("bundle.passphrasePlaceholder")}
            className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("bundle.passphraseNote")}</p>
        <Button
          size="sm"
          className="rounded-md px-4"
          onClick={() => void onExport()}
          disabled={chosen == null || exporting}
        >
          {exporting ? t("bundle.exporting") : t("bundle.exportButton")}
        </Button>
        {/* The export dialog has to say what the file holds (C9.5). */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("bundle.exportWarning")}
        </p>

        <hr className="border-border/60" />

        <p className="text-sm font-medium">{t("bundle.importHeading")}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("bundle.importNote")}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            aria-label={t("bundle.fileLabel")}
            type="file"
            accept=".mirrai-persona,application/octet-stream"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <input
            aria-label={t("bundle.importPassphraseLabel")}
            type="password"
            value={importPassphrase}
            onChange={(event) => setImportPassphrase(event.target.value)}
            maxLength={1024}
            placeholder={t("bundle.importPassphrasePlaceholder")}
            className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            className="rounded-md bg-transparent"
            onClick={() => void onImport()}
            disabled={!file || importing}
          >
            {importing ? t("bundle.importing") : t("bundle.importButton")}
          </Button>
        </div>
      </div>
    </section>
  );
}
