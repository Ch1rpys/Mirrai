import { useEffect, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Theme = "classic" | "im-green" | "im-blue";

const THEMES: Array<{ id: Theme; labelKey: "skin.classic" | "skin.green" | "skin.blue" }> = [
  { id: "classic", labelKey: "skin.classic" },
  { id: "im-green", labelKey: "skin.green" },
  { id: "im-blue", labelKey: "skin.blue" },
];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * The chat's appearance (B7.15).
 *
 * A neutral layout, a note the user may put on the persona's name, and a
 * background picture. Nothing here changes what the persona says.
 */
export default function SkinPicker({
  personaId,
  name = "",
}: {
  personaId: number;
  /** The persona's name, for the note field's label. */
  name?: string;
}) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(t("skin.saved"));
      settings.refetch();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const upload = trpc.persona.uploadBackground.useMutation({
    onSuccess: () => {
      toast.success(t("skin.backgroundSaved"));
      settings.refetch();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const clear = trpc.persona.clearBackground.useMutation({
    onSuccess: () => settings.refetch(),
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const stored = settings.data?.skin;
  const [theme, setTheme] = useState<Theme>(stored?.theme ?? "classic");
  const [alias, setAlias] = useState(stored?.alias ?? "");

  useEffect(() => {
    setTheme(stored?.theme ?? "classic");
    setAlias(stored?.alias ?? "");
  }, [stored?.theme, stored?.alias]);

  const busy = update.isPending || upload.isPending || clear.isPending;

  function save(nextTheme: Theme = theme, nextAlias = alias) {
    update.mutate({
      id: personaId,
      patch: { skin: { theme: nextTheme, alias: nextAlias.trim() } },
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("skin.tooLarge"));
      return;
    }
    try {
      upload.mutate({ personaId, base64: await readAsDataUrl(file) });
    } catch {
      toast.error(t("skin.unreadable"));
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">{t("skin.title")}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{t("skin.note")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={theme === option.id}
            disabled={busy}
            onClick={() => {
              setTheme(option.id);
              save(option.id, alias);
            }}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              theme === option.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            <span
              data-testid={`skin-preview-${option.id}`}
              aria-hidden="true"
              className={`skin-preview skin-preview-${option.id}`}
            >
              <span className="skin-preview-bubble skin-preview-bubble-them" />
              <span className="skin-preview-bubble skin-preview-bubble-me" />
            </span>
            <span>{t(option.labelKey)}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground space-y-1">
          <span className="block">{t("skin.aliasLabel", { name })}</span>
          <input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder={t("skin.aliasPlaceholder")}
            aria-label={t("skin.aliasLabel", { name })}
            maxLength={40}
            className="h-8 w-48 rounded-md border border-input bg-card px-2 text-xs text-foreground"
          />
        </label>
        <Button size="sm" variant="outline" className="rounded-md text-xs" disabled={busy} onClick={() => save()}>
          {t("skin.saveAlias")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/40">
          {upload.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          {t("skin.chooseBackground")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={t("skin.chooseBackground")}
            className="sr-only"
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        {stored?.background && (
          <>
            <img
              src={stored.background}
              alt={t("skin.backgroundAlt")}
              className="h-10 w-16 rounded-sm object-cover border border-border"
            />
            <Button
              size="sm"
              variant="ghost"
              className="rounded-md text-xs"
              disabled={busy}
              onClick={() => clear.mutate({ personaId })}
            >
              {t("skin.clearBackground")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
