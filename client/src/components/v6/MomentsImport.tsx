import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MomentRow {
  text: string;
  at: string | null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * The public register (B7.12): moments, pasted or read from a
 * screenshot.
 *
 * These rows are stored as `public`. They never join the one-to-one
 * conversation and never change its voice.
 */
export default function MomentsImport({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const capabilities = trpc.system.capabilities.useQuery();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [images, setImages] = useState<Array<{ name: string; base64: string }>>([]);
  const [rows, setRows] = useState<MomentRow[] | null>(null);

  const preview = trpc.import.momentsPreview.useMutation({
    onSuccess: (data) => {
      setRows(data.posts.map((post) => ({ text: post.text, at: post.at })));
      if (data.posts.length === 0) toast.info(t("moments.empty"));
      for (const failure of data.failures) {
        toast.error(t("moments.failure", { n: failure.index + 1 }));
      }
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const confirm = trpc.import.momentsConfirm.useMutation({
    onSuccess: (data) => {
      toast.success(t("moments.saved", { n: data.written }));
      setRows(null);
      setText("");
      setImages([]);
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const canSee = (capabilities.data?.visionProviders ?? []).length > 0;
  const providerName = capabilities.data?.visionProviders?.[0] ?? "";
  const hasEmpty = (rows ?? []).some((row) => !row.text.trim());

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next: Array<{ name: string; base64: string }> = [];
    for (const file of Array.from(list).slice(0, 30)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(t("moments.tooLarge", { name: file.name }));
        continue;
      }
      try {
        next.push({ name: file.name, base64: await readAsDataUrl(file) });
      } catch {
        toast.error(t("moments.unreadableFile", { name: file.name }));
      }
    }
    setImages(next);
  }

  return (
    <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up space-y-3">
      <div>
        <h2 className="font-display text-base font-semibold text-foreground">
          {t("moments.title")}
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
          {t("moments.note")}
        </p>
        {canSee ? (
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            {t("moments.screenshotNote", { provider: providerName })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            {t("moments.noVision")}
          </p>
        )}
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        placeholder={t("moments.placeholder")}
        aria-label={t("moments.placeholder")}
        className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground space-y-1">
          <span className="block">{t("moments.dateLabel")}</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs"
          />
        </label>
        <label className={`inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-xs ${canSee ? "cursor-pointer hover:bg-muted/40" : "opacity-50 cursor-not-allowed"}`}>
          {t("moments.chooseScreenshots")}
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
        {images.length > 0 && (
          <span className="text-xs text-muted-foreground">{t("moments.chosen", { n: images.length })}</span>
        )}
        <Button
          size="sm"
          className="rounded-md"
          disabled={preview.isPending || (!text.trim() && images.length === 0)}
          onClick={() =>
            preview.mutate({
              personaId,
              text: text.trim() || undefined,
              images: images.length ? images : undefined,
              date: date || undefined,
            })
          }
        >
          {preview.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t("moments.read")}
        </Button>
      </div>

      {rows && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-start gap-2 rounded-md border border-border/70 p-2">
              <textarea
                value={row.text}
                rows={2}
                aria-label={t("moments.text")}
                onChange={(event) =>
                  setRows((current) =>
                    (current ?? []).map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  )
                }
                className="flex-1 min-w-0 rounded-md border border-input bg-card px-2 py-1 text-xs"
              />
              <input
                type="datetime-local"
                value={row.at ? row.at.slice(0, 16) : ""}
                aria-label={t("moments.time")}
                onChange={(event) =>
                  setRows((current) =>
                    (current ?? []).map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            at: event.target.value
                              ? new Date(event.target.value).toISOString()
                              : null,
                          }
                        : item,
                    ),
                  )
                }
                className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
              />
              <button
                type="button"
                aria-label={t("moments.remove")}
                className="p-1 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setRows((current) => (current ?? []).filter((_, i) => i !== index))
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <Button
            size="sm"
            className="rounded-md"
            disabled={confirm.isPending || hasEmpty}
            onClick={() => confirm.mutate({ personaId, posts: rows })}
          >
            {confirm.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("moments.confirm", { n: rows.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
