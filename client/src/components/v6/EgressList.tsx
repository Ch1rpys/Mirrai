import { useLocale } from "@/contexts/LocaleContext";
import { EGRESS_ITEMS } from "@shared/egress";

/**
 * Where this app talks to the network.
 *
 * The list is the same one the document and the guard test read. It is
 * read-only: turning something off happens in the place each row names.
 */
export default function EgressList() {
  const { t, locale } = useLocale();
  const lang = locale === "en" ? "en" : "zh";

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.data.egressTitle")}
        </h2>
        <p className="kicker mt-1.5">{t("settings.data.egressNote")}</p>
      </div>
      <ul className="space-y-3">
        {EGRESS_ITEMS.map((item) => (
          <li
            key={item.id}
            className="rounded-md border border-border/60 p-3 space-y-1.5"
          >
            <p className="text-sm text-foreground leading-relaxed">
              <span className="text-muted-foreground">{t("settings.data.egressDestination")} · </span>
              {item.destination[lang]}
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              <span className="text-muted-foreground">{t("settings.data.egressSends")} · </span>
              {item.payload[lang]}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span>{item.defaultOn ? t("settings.data.egressOn") : t("settings.data.egressOff")}</span>
              {" · "}
              {item.offHow[lang]}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
