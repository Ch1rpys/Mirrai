import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface CityCandidate {
  name: string;
  latitude: number;
  longitude: number;
  country?: string | null;
  admin1?: string | null;
  timezone?: string | null;
}

/**
 * The long-distance section (C5.1, C5.2).
 *
 * One date: the next time the two of them will be in the same place.
 * One city: where they are, used only to show the weather and the light
 * on the chat page. Nothing is pushed and nothing is counted down
 * anywhere except on the chat page.
 *
 * The city is sent to Open-Meteo only when the user presses search, and
 * the weather request sends only a rounded coordinate. Both are off by
 * default and there is no entry at all when the operator switched the
 * feature off.
 */
export default function LdrSettings({
  personaId,
  name = "",
}: {
  personaId: number;
  name?: string;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CityCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const status = trpc.ldr.status.useQuery();
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => settings.refetch(),
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const search = trpc.ldr.searchCity.useMutation({
    onSuccess: (data) => {
      setResults(data.results as CityCandidate[]);
      setSearched(true);
    },
    onError: () => toast.error(t("ldr.searchFailed")),
  });

  const stored = settings.data?.ldr?.nextMeetAt ?? "";
  const city = settings.data?.ldr?.city;
  const weather = Boolean(settings.data?.ldr?.weather);
  const [date, setDate] = useState(stored);

  useEffect(() => {
    setDate(stored);
  }, [stored]);

  function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error(t("ldr.dateFirst"));
      return;
    }
    update.mutate(
      { id: personaId, patch: { ldr: { nextMeetAt: date } } },
      {
        onSuccess: () => toast.success(t("ldr.saved")),
      },
    );
  }

  function clear() {
    update.mutate(
      { id: personaId, patch: { ldr: { nextMeetAt: null } } },
      {
        onSuccess: () => toast.success(t("ldr.cleared")),
      },
    );
  }

  function chooseCity(candidate: CityCandidate) {
    update.mutate(
      {
        id: personaId,
        patch: {
          ldr: {
            city: {
              name: candidate.name,
              lat: candidate.latitude,
              lng: candidate.longitude,
              ...(candidate.timezone ? { timezone: candidate.timezone } : {}),
            },
          },
        },
      },
      {
        onSuccess: () => {
          toast.success(t("ldr.cityChosen"));
          setResults([]);
          setSearched(false);
          setQuery("");
        },
      },
    );
  }

  function clearCity() {
    update.mutate({ id: personaId, patch: { ldr: { city: null, weather: false } } });
  }

  const weatherAvailable = status.data?.enabled !== false;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="section-title">{t("ldr.sectionTitle")}</h2>
        <p className="text-muted-foreground text-sm mt-1">{t("ldr.sectionHint")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ldr-next-meet" className="text-xs text-muted-foreground">
          {t("ldr.nextMeet")}
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="ldr-next-meet"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-44"
          />
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {t("ldr.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={update.isPending || !stored}>
            {t("ldr.clear")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("ldr.nextMeetHint")}</p>
      </div>

      {weatherAvailable && (
        <div className="space-y-2">
          <Label htmlFor="ldr-city" className="text-xs text-muted-foreground">
            {t("ldr.cityLabel")}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="ldr-city"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("ldr.cityPlaceholder")}
              className="w-56"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={search.isPending || query.trim().length === 0}
              onClick={() => search.mutate({ name: query.trim() })}
            >
              {search.isPending ? t("ldr.searching") : t("ldr.search")}
            </Button>
            {city && (
              <Button size="sm" variant="ghost" onClick={clearCity} disabled={update.isPending}>
                {t("ldr.clearCity")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{t("ldr.searchHint")}</p>
          {searched && results.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("ldr.noResults")}</p>
          )}
          {results.length > 0 && (
            <ul className="space-y-1">
              {results.map((candidate, index) => (
                <li
                  key={`${candidate.name}-${candidate.latitude}-${candidate.longitude}-${index}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {candidate.name}
                    {candidate.country ? ` · ${candidate.country}` : ""}
                    {candidate.admin1 && candidate.admin1 !== candidate.name
                      ? ` · ${candidate.admin1}`
                      : ""}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => chooseCity(candidate)}>
                    {t("ldr.choose")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {city && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={weather}
                disabled={update.isPending}
                onChange={(event) =>
                  update.mutate({ id: personaId, patch: { ldr: { weather: event.target.checked } } })
                }
                className="mt-0.5"
              />
              <span>
                <span className="block">{t("ldr.weatherToggle", { name: name || t("common.them") })}</span>
                <span className="block text-xs text-muted-foreground leading-relaxed">
                  {t("ldr.weatherHint")}
                </span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
