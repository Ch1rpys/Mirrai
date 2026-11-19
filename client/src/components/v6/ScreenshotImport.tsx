import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { RecordKind } from "@shared/records";

interface EditableRow {
  role: "user" | "assistant";
  content: string;
  kind: RecordKind;
  at: string | null;
  unclear: boolean;
}

const MAX_SCREENSHOTS = 30;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Importing a chat from screenshots (B7.11).
 *
 * The picture goes to the user's own vision model, and what comes back
 * is a *draft*: every row can be corrected, switched to the other side,
 * re-timed, or removed. Nothing is written until the user confirms.
 */
export default function ScreenshotImport({
  personaId,
  personaName,
}: {
  personaId: number;
  personaName: string;
}) {
  const { t } = useLocale();
  const capabilities = trpc.system.capabilities.useQuery();
  const [images, setImages] = useState<Array<{ name: string; base64: string }>>([]);
  const [date, setDate] = useState("");
  const [rows, setRows] = useState<EditableRow[] | null>(null);
  const [needsDate, setNeedsDate] = useState(false);
  const [timeApprox, setTimeApprox] = useState(false);
  const [failures, setFailures] = useState<Array<{ index: number; message: string }>>([]);

  const preview = trpc.import.screenshotPreview.useMutation({
    onSuccess: (data) => {
      setRows(data.rows as EditableRow[]);
      setNeedsDate(data.needsDate);
      setTimeApprox(data.timeApprox);
      setFailures(data.failures);
      if (data.rows.length === 0) toast.info(t("screenshot.empty"));
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const confirm = trpc.import.screenshotConfirm.useMutation({
    onSuccess: (data) => {
      toast.success(t("screenshot.saved", { n: data.written }));
      setRows(null);
      setImages([]);
      setFailures([]);
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const visionProviders = capabilities.data?.visionProviders ?? [];
  const canSee = visionProviders.length > 0;
  const providerName = visionProviders[0] ?? capabilities.data?.defaultProvider ?? "";
  const hasEmptyRows = (rows ?? []).some((row) => row.content.trim().length === 0);

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    if (files.length > MAX_SCREENSHOTS) {
      toast.error(t("screenshot.tooMany"));
      return;
    }
    const next: Array<{ name: string; base64: string }> = [];
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(t("screenshot.tooLarge", { name: file.name }));
        continue;
      }
      try {
        next.push({ name: file.name, base64: await readAsDataUrl(file) });
      } catch {
        toast.error(t("screenshot.unreadableFile", { name: file.name }));
      }
    }
    setImages(next);
    setRows(null);
  }

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((current) =>
      (current ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(index: number) {
    setRows((current) => (current ?? []).filter((_, i) => i !== index));
  }

  return (
    <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up space-y-3">
      <div>
        <h2 className="font-display text-base font-semibold text-foreground">
          {t("screenshot.title")}
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
          {canSee
            ? t("screenshot.beforeUpload", { provider: providerName })
            : t("screenshot.noVision")}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={`inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-xs ${canSee ? "cursor-pointer hover:bg-muted/40" : "opacity-50 cursor-not-allowed"}`}>
          {t("screenshot.choose")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={!canSee}
            className="sr-only"
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className="text-xs text-muted-foreground space-y-1">
          <span className="block">{t("screenshot.dateLabel")}</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground"
          />
        </label>
        <Button
          size="sm"
          className="rounded-md"
          disabled={!canSee || images.length === 0 || preview.isPending}
          onClick={() => preview.mutate({ personaId, images, date: date || undefined })}
        >
          {preview.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {preview.isPending ? t("screenshot.recognizing") : t("screenshot.recognize")}
        </Button>
        {images.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("screenshot.chosen", { n: images.length })}
          </span>
        )}
      </div>

      {needsDate && (
        <p className="text-xs text-destructive">{t("screenshot.needDate")}</p>
      )}
      {timeApprox && (
        <p className="text-xs text-muted-foreground">{t("screenshot.approx")}</p>
      )}
      {failures.length > 0 && (
        <ul className="space-y-0.5">
          {failures.map((failure) => (
            <li key={failure.index} className="text-xs text-muted-foreground">
              {t("screenshot.failure", { n: failure.index + 1, message: failure.message })}
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("screenshot.reviewNote", { name: personaName })}
          </p>
          <div className="space-y-1.5">
            {rows.map((row, index) => (
              <div
                key={index}
                className={`flex items-start gap-2 rounded-md border p-2 ${
                  row.unclear ? "border-amber-500/60 bg-amber-500/5" : "border-border/70"
                }`}
              >
                <select
                  value={row.role === "user" ? "right" : "left"}
                  onChange={(event) =>
                    updateRow(index, {
                      role: event.target.value === "right" ? "user" : "assistant",
                    })
                  }
                  aria-label={t("screenshot.side")}
                  className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
                >
                  <option value="left">{t("screenshot.left")}</option>
                  <option value="right">{t("screenshot.right")}</option>
                </select>
                <input
                  value={row.content}
                  onChange={(event) => updateRow(index, { content: event.target.value })}
                  aria-label={t("screenshot.text")}
                  className="h-7 flex-1 min-w-0 rounded-md border border-input bg-card px-2 text-xs"
                />
                <input
                  type="datetime-local"
                  value={row.at ? row.at.slice(0, 16) : ""}
                  onChange={(event) =>
                    updateRow(index, {
                      at: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    })
                  }
                  aria-label={t("screenshot.time")}
                  className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
                />
                <button
                  type="button"
                  aria-label={t("screenshot.remove")}
                  className="p-1 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            className="rounded-md"
            disabled={confirm.isPending || hasEmptyRows}
            onClick={() =>
              confirm.mutate({
                personaId,
                rows: rows.map((row) => ({
                  role: row.role,
                  content: row.content,
                  kind: row.kind,
                  at: row.at,
                })),
              })
            }
          >
            {confirm.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("screenshot.confirm", { n: rows.length })}
          </Button>
          {hasEmptyRows && (
            <p className="text-xs text-muted-foreground">{t("screenshot.emptyRows")}</p>
          )}
        </div>
      )}
    </div>
  );
}
