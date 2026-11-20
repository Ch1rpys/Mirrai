import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";

/**
 * The first and the last of each thing (C2.6).
 *
 * The two endings are folded away when the hall would not feature this
 * persona: a relationship that has ended does not need "the last time
 * they called" on the page the moment it is opened.
 */
const LABELS: Record<string, string> = {
  firstLine: "report.firsts.firstLine",
  lastLine: "report.firsts.lastLine",
  firstGoodnightMe: "report.firsts.firstGoodnightMe",
  firstGoodnightThem: "report.firsts.firstGoodnightThem",
  firstMorningMe: "report.firsts.firstMorningMe",
  firstMorningThem: "report.firsts.firstMorningThem",
  firstLoveMe: "report.firsts.firstLoveMe",
  firstLoveThem: "report.firsts.firstLoveThem",
  firstFight: "report.firsts.firstFight",
  firstPhoto: "report.firsts.firstPhoto",
  firstSticker: "report.firsts.firstSticker",
  firstVoice: "report.firsts.firstVoice",
  firstCall: "report.firsts.firstCall",
  lastCall: "report.firsts.lastCall",
  longestCall: "report.firsts.longestCall",
};

export default function FirstsList({
  personaId,
  mayFeature: featured,
}: {
  personaId: number;
  mayFeature: boolean;
}) {
  const { t } = useLocale();
  const [opened, setOpened] = useState(false);
  const query = trpc.record.firsts.useQuery({ personaId }, { enabled: personaId > 0 });
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
  const items = query.data ?? [];
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("report.empty")}</p>;
  }
  const endings = new Set(["lastLine", "lastCall"]);
  const visible = featured || opened ? items : items.filter((item) => !endings.has(item.key));

  return (
    <div className="space-y-2">
      {visible.map((item) => (
        <div key={item.key} className="rounded border border-border/70 px-3 py-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {LABELS[item.key] ? t(LABELS[item.key] as "report.firsts.firstLine") : item.key}
          </p>
          <p className="text-foreground">{item.text}</p>
          <p className="text-[11px] text-muted-foreground">
            <span>{item.at.slice(0, 10)}</span>
            <a
              className="ml-2 underline underline-offset-2"
              href={`/persona/${personaId}/records?at=${item.recordId}`}
            >
              {t("records.onThisDayOpen")}
            </a>
          </p>
        </div>
      ))}
      {!featured && !opened && items.some((item) => endings.has(item.key)) && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("report.firsts.folded")}</p>
          <Button size="sm" variant="outline" onClick={() => setOpened(true)}>
            {t("report.firsts.open")}
          </Button>
        </div>
      )}
    </div>
  );
}
