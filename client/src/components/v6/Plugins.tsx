import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";

/**
 * The plugins this process loaded (C9.7).
 *
 * A plugin is code the person put in their own data directory, running
 * inside the app with the app's permissions. The list is read-only and
 * says that plainly — and it shows the outbound addresses each plugin
 * declares, because those are the one part of "what will this code do"
 * a plugin can answer before it runs.
 */
export default function Plugins() {
  const { t } = useLocale();
  const status = trpc.plugins.list.useQuery();

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.data.pluginsTitle")}
        </h2>
        <p className="kicker mt-1.5">{t("settings.data.pluginsNote")}</p>
      </div>

      {status.isLoading && (
        <p className="text-sm text-muted-foreground">{t("settings.data.pluginsLoading")}</p>
      )}

      {status.isError && (
        <div className="space-y-3">
          <p className="text-sm text-destructive">{t("settings.data.pluginsLoadFailed")}</p>
          <Button size="sm" variant="outline" onClick={() => status.refetch()}>
            {t("settings.data.pluginsRetry")}
          </Button>
        </div>
      )}

      {status.data && !status.data.enabled && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("settings.data.pluginsOff")}
        </p>
      )}

      {status.data && status.data.enabled && status.data.plugins.length === 0 && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("settings.data.pluginsEmpty")}
        </p>
      )}

      {status.data && status.data.enabled && status.data.plugins.length > 0 && (
        <ul className="space-y-3">
          {status.data.plugins.map((plugin) => (
            <li
              key={plugin.id}
              className="rounded-md border border-border/60 p-3 space-y-1.5"
            >
              <p className="text-sm text-foreground leading-relaxed">
                <span className="font-medium">{plugin.name}</span>
                <span className="text-muted-foreground"> · {plugin.version} · </span>
                <span className="text-muted-foreground">
                  {plugin.kind === "importer"
                    ? t("settings.data.pluginsKindImporter")
                    : t("settings.data.pluginsKindChannel")}
                </span>
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed break-all">
                {plugin.id}
              </p>
              <p className="text-sm text-foreground leading-relaxed">
                <span className="text-muted-foreground">
                  {t("settings.data.pluginsEgress")} ·{" "}
                </span>
                {plugin.egress.length > 0
                  ? plugin.egress.join(", ")
                  : t("settings.data.pluginsNoEgress")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
