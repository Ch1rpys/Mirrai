import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useDayKey } from "@/lib/day";
import { Button } from "@/components/ui/button";
import { isSafeMediaUrl } from "@shared/safe-url";

/**
 * The places and the songs of the record (C2.8).
 *
 * The basemap is not loaded unless the operator configured one and the
 * user asks for it: a tile request tells a third party which part of
 * the map is being looked at.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function PlacesPanel({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const day = useDayKey();
  const query = trpc.record.places.useQuery({ personaId }, { enabled: personaId > 0 });
  const [basemap, setBasemap] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ tile?: { addTo: (map: unknown) => void } } | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const withCoords = query.data.places.filter(
      (place) => place.lat != null && place.lng != null,
    );
    if (withCoords.length === 0 || !container.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const leaflet = (await import("leaflet")).default;
        if (cancelled || !container.current) return;
        const map = leaflet.map(container.current).setView(
          [withCoords[0].lat!, withCoords[0].lng!],
          11,
        );
        for (const place of withCoords) {
          leaflet.marker([place.lat!, place.lng!]).addTo(map).bindPopup(place.name);
        }
        mapRef.current = map as never;
      } catch {
        /* No map is better than a broken page. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query.data]);

  useEffect(() => {
    if (!basemap || !query.data?.tileUrl || !mapRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const leaflet = (await import("leaflet")).default;
        if (cancelled || !mapRef.current) return;
        const layer = leaflet.tileLayer(query.data!.tileUrl!, {
          attribution: hostOf(query.data!.tileUrl!),
        });
        layer.addTo(mapRef.current as never);
        mapRef.current.tile = layer as never;
      } catch {
        /* Leave the blank map. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [basemap, query.data]);

  if (query.isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p>{t("report.failed")}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => query.refetch()}>
          {t("report.retry")}
        </Button>
      </div>
    );
  }
  const places = query.data?.places ?? [];
  const tileUrl = query.data?.tileUrl ?? null;
  if (places.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("report.places.empty")}</p>;
  }
  return (
    <div className="space-y-3">
      {tileUrl && (
        <div className="rounded-lg border border-border/70 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={basemap}
              onChange={(event) => setBasemap(event.target.checked)}
            />
            {t("report.places.mapToggle")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {t("report.places.mapNote", { host: hostOf(tileUrl) })}
          </p>
        </div>
      )}
      <div ref={container} className="h-64 rounded-lg border border-border/70 bg-muted/20" data-testid="places-map" />
      <div className="space-y-1">
        {places.map((place) => (
          <div key={`${place.name}-${place.lat ?? ""}-${place.lng ?? ""}`} className="rounded border border-border/70 px-3 py-2 text-sm">
            <p className="text-foreground">{place.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {t("report.places.count", { n: place.count })} · {t("report.places.first", { date: day(place.first) })} · {t("report.places.last", { date: day(place.last) })}
            </p>
            {place.samples.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{t("report.places.samples")}</span>
                {place.samples.slice(0, 5).map((sample) => (
                  sample.recordId != null ? (
                    <a
                      key={`r-${sample.recordId}`}
                      href={`/persona/${personaId}/records?at=${sample.recordId}`}
                      className="underline underline-offset-2"
                    >
                      {day(sample.at)}
                    </a>
                  ) : sample.url ? (
                    <a
                      key={`m-${sample.mediaId}`}
                      href={sample.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {day(sample.at)}
                    </a>
                  ) : (
                    <span key={`m-${sample.mediaId}`}>{day(sample.at)}</span>
                  )
                ))}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SongsPanel({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const day = useDayKey();
  const query = trpc.record.songs.useQuery({ personaId }, { enabled: personaId > 0 });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p>{t("report.failed")}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => query.refetch()}>
          {t("report.retry")}
        </Button>
      </div>
    );
  }
  const songs = query.data ?? [];
  if (songs.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("report.songs.empty")}</p>;
  }
  return (
    <div className="space-y-1">
      {songs.map((song) => (
        <div key={`${song.title}-${song.artist ?? ""}`} className="rounded border border-border/70 px-3 py-2 text-sm">
          <p className="text-foreground">
            {song.url && isSafeMediaUrl(song.url) ? (
              <a href={song.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {song.title}
              </a>
            ) : (
              song.title
            )}
            {song.artist && <span className="text-muted-foreground"> · {song.artist}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("report.songs.sharedByMe", { n: song.sharedByMe })} · {t("report.songs.sharedByThem", { n: song.sharedByThem })} · {t("report.songs.first", { date: day(song.first) })}
          </p>
        </div>
      ))}
    </div>
  );
}
