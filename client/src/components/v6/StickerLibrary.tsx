import { useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";

/**
 * The stickers the record says they used.
 *
 * A sticker is listed because it is in the record, with the number of
 * times it was sent. Turning one off keeps it out of replies without
 * throwing the history away; deleting removes it; and a sticker the
 * export only named can be given its picture.
 */
export default function StickerLibrary(props: { personaId: number; name: string }) {
  const { t } = useLocale();
  const list = trpc.sticker.list.useQuery(
    { personaId: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const utils = trpc.useUtils();
  const setEnabled = trpc.sticker.setEnabled.useMutation({
    onSuccess: () => utils.sticker.list.invalidate({ personaId: props.personaId }),
    onError: (error) => toast.error(error.message),
  });
  const remove = trpc.sticker.delete.useMutation({
    onSuccess: () => utils.sticker.list.invalidate({ personaId: props.personaId }),
    onError: (error) => toast.error(error.message),
  });
  const upload = trpc.sticker.upload.useMutation({
    onSuccess: () => utils.sticker.list.invalidate({ personaId: props.personaId }),
    onError: (error) => toast.error(error.message),
  });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadingFor = useRef<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function pickImage(label: string, file: File | null) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("stickerLibrary.uploadFailed"));
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      upload.mutate({
        personaId: props.personaId,
        label,
        base64: btoa(binary),
      });
    } catch {
      toast.error(t("stickerLibrary.uploadFailed"));
    }
  }

  if (list.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (list.isError) {
    /**
     * A failed read is not an empty library.
     *
     * Rendering the failure as "they never used a sticker" would be a
     * lie about the record, and the retry would be hidden behind it.
     */
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("stickerLibrary.loadFailed")}</p>
        <Button size="sm" variant="outline" onClick={() => list.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const stickers = list.data?.stickers ?? [];
  const limit = list.data?.limit ?? 0;
  if (stickers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("stickerLibrary.empty", { name: props.name })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-foreground">{t("stickerLibrary.title")}</p>
        <p className="text-[11px] text-muted-subtle">
          {t("stickerLibrary.count", { n: stickers.length, max: limit })}
        </p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("stickerLibrary.hint", { name: props.name })}
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stickers.map((sticker) => (
          <li
            key={sticker.id}
            className={`rounded-lg border border-border/70 p-2 space-y-1.5 ${sticker.enabled ? "" : "opacity-50"}`}
          >
            <div className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-muted/30">
              {sticker.imageUrl ? (
                <img
                  src={sticker.imageUrl}
                  alt={sticker.label}
                  className="max-h-20 max-w-full object-contain"
                />
              ) : (
                <span className="px-1 text-center text-xs text-muted-foreground">
                  {t("stickerLibrary.noImage")}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-foreground" title={sticker.label}>
              {sticker.label || t("stickerLibrary.unnamed")}
            </p>
            <p className="text-[11px] text-muted-subtle">
              {t("stickerLibrary.uses", { n: sticker.usesByThem })}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={sticker.enabled}
                  disabled={setEnabled.isPending}
                  onChange={(event) =>
                    setEnabled.mutate({
                      personaId: props.personaId,
                      stickerId: sticker.id,
                      enabled: event.target.checked,
                    })
                  }
                />
                {t("stickerLibrary.enabled")}
              </label>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  uploadingFor.current = sticker.label;
                  fileInput.current?.click();
                }}
              >
                {t("stickerLibrary.addImage")}
              </button>
              {confirming === sticker.id ? (
                <span className="inline-flex gap-1">
                  <button
                    type="button"
                    className="text-[11px] text-destructive"
                    onClick={() => {
                      remove.mutate({ personaId: props.personaId, stickerId: sticker.id });
                      setConfirming(null);
                    }}
                  >
                    {t("common.confirm")}
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground"
                    onClick={() => setConfirming(null)}
                  >
                    {t("common.cancel")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="text-[11px] text-muted-subtle hover:text-destructive"
                  onClick={() => setConfirming(sticker.id)}
                >
                  {t("common.delete")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (uploadingFor.current) void pickImage(uploadingFor.current, file);
          uploadingFor.current = null;
        }}
      />
    </div>
  );
}
