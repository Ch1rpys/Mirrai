import { useState } from "react";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { formatInstantInZone, formatMonthKey } from "@/lib/dates";
import { zonedDateKey } from "@shared/timezone";

interface Photo {
  id: number;
  url: string;
  at: Date | string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * The photographs of one persona, by month (B7.8).
 *
 * Every picture here came from the user's own records or uploads.
 * Nothing is generated. The date is the camera's when it had one, and
 * the import time when it did not.
 */
export default function PhotoTimeline({
  personaId,
  name,
  timeZone,
}: {
  personaId: number;
  name: string;
  timeZone?: string | null;
}) {
  const { t, locale } = useLocale();
  const { data, isLoading, isError, refetch } = trpc.media.listPhotos.useQuery({
    personaId,
    limit: 500,
  });
  const [open, setOpen] = useState<Photo | null>(null);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (isError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("photos.loadFailed")}{" "}
        <button type="button" className="underline" onClick={() => refetch()}>
          {t("common.retry")}
        </button>
      </p>
    );
  }
  const photos = data?.photos ?? [];
  if (photos.length === 0) {
    return <p className="text-xs text-muted-foreground leading-relaxed">{t("photos.empty")}</p>;
  }

  const groups = new Map<string, Photo[]>();
  for (const photo of photos) {
    const key = photo.at ? zonedDateKey(new Date(photo.at), timeZone).slice(0, 7) : "";
    const list = groups.get(key) ?? [];
    list.push(photo);
    groups.set(key, list);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{t("photos.title", { name })}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{t("photos.note")}</p>
      </div>
      {[...groups.entries()].map(([month, list]) => (
        <section key={month || "unknown"} className="space-y-1.5">
          <h4 className="text-xs text-muted-foreground">
            {month ? formatMonthKey(month, locale) : t("photos.noDate")}
          </h4>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
            {list.map((photo) => (
              <button
                key={photo.id}
                type="button"
                className="aspect-square overflow-hidden rounded-sm border border-border/60 hover:border-primary transition-colors"
                title={t("photos.open")}
                onClick={() => setOpen(photo)}
              >
                <img src={photo.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("photos.open")}
          onClick={() => setOpen(null)}
        >
          <div className="relative max-w-3xl max-h-full" onClick={(event) => event.stopPropagation()}>
            <img
              src={open.url}
              alt={t("photos.open")}
              className="max-h-[80vh] max-w-full rounded-md object-contain bg-black"
            />
            <p className="text-center text-xs text-white/80 mt-2">
              {open.at
                ? formatInstantInZone(open.at, locale, timeZone)
                : t("photos.noDate")}
            </p>
            <button
              type="button"
              className="absolute -top-3 -right-3 rounded-full bg-background p-1.5 shadow"
              aria-label={t("photos.close")}
              onClick={() => setOpen(null)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
