import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { copy } from "@shared/copy";
import {
  mergePersonEntries,
  normalizePeople,
  type Person,
} from "@shared/people";
import {
  normalizeStances,
  STANCE_POLARITIES,
  type Stance,
  type StancePolarity,
} from "@shared/stances";
import type { TranslationKey } from "@/i18n";

/**
 * The world around them: people they mention, and how they feel about things.
 *
 * Daily rhythm lives with the life-event editor — it is a kind of
 * life event, not a third table.
 *
 * Each row is only a candidate until the user says it is real.
 * Confirming puts it in the prompt on the turns that mention it;
 * rejecting keeps a later re-run from bringing it back.
 */

let stamp = 0;
function nextId(prefix: string): string {
  stamp += 1;
  return `${prefix}-${Date.now()}-${stamp}`;
}

const POLARITY_LABEL: Record<StancePolarity, TranslationKey> = {
  like: "stances.like",
  dislike: "stances.dislike",
  fear: "stances.fear",
  care: "stances.care",
  opinion: "stances.opinion",
};

export default function WorldEditors({ personaId }: { personaId: number }) {
  return (
    <div className="space-y-8">
      <PeopleEditor personaId={personaId} />
      <StancesEditor personaId={personaId} />
    </div>
  );
}

function PeopleEditor({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const lang = locale === "en" ? "en" : "zh";
  const { data, refetch, isError } = trpc.people.list.useQuery({ personaId });
  const save = trpc.people.save.useMutation({
    onSuccess: () => { toast.success(t("imperfection.saved")); refetch(); },
    onError: (e: { message?: string }) => toast.error(e.message),
  });
  const mine = trpc.people.mine.useMutation({
    onSuccess: (result) => {
      if (!result.people.length) toast.info(result.hint ?? copy(lang, "labels.people.minedNone"));
      else toast.success(copy(lang, "labels.people.mine"));
      refetch();
    },
    onError: (e: { message?: string }) => toast.error(e.message),
  });
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const people = normalizePeople(data?.people);

  function persist(next: Person[]) {
    save.mutate({ personaId, people: next });
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("people.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("people.hint")}</p>
        {data?.hint ? <p className="text-[11px] text-muted-subtle">{data.hint}</p> : null}
      </header>
      {isError ? <p className="text-xs text-destructive" role="alert">{t("common.error")}</p> : null}
      {people.length === 0 ? (
        <p className="text-xs text-muted-subtle">{t("people.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {people.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3 space-y-1.5">
              <p className="text-sm">
                <span className="font-medium">{row.name}</span>
                {row.aliases.length ? (
                  <span className="text-muted-foreground"> {t("people.aliases", { names: row.aliases.join(", ") })}</span>
                ) : null}
                <span className="text-muted-subtle"> · {t("people.mentions", { n: row.mentions })}</span>
              </p>
              <Input
                value={row.relation}
                onChange={(e) => persist(people.map((item) => item.id === row.id ? { ...item, relation: e.target.value.slice(0, 20) } : item))}
                placeholder={t("people.relation")}
                maxLength={20}
                aria-label={t("people.relation")}
              />
              <div className="flex flex-wrap gap-2">
                {!row.verified ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => persist(people.map((item) => item.id === row.id ? { ...item, verified: true } : item))}
                    >
                      {t("people.confirm")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => persist(people.filter((item) => item.id !== row.id))}
                    >
                      {t("people.reject")}
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-subtle">{t("people.verified")}</span>
                )}
                {people.length > 1 ? (
                  <select
                    className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                    defaultValue=""
                    aria-label={t("people.mergeInto")}
                    onChange={(e) => {
                      const intoId = e.target.value;
                      e.target.value = "";
                      if (!intoId) return;
                      persist(mergePersonEntries(people, row.id, intoId));
                    }}
                  >
                    <option value="">{t("people.mergeInto")}</option>
                    {people.filter((item) => item.id !== row.id).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("people.name")}
          maxLength={40}
        />
        <Input
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          placeholder={t("people.relation")}
          maxLength={20}
        />
        <Button
          size="sm"
          disabled={!name.trim() || save.isPending}
          onClick={() => {
            persist([...people, {
              id: nextId("manual"),
              name: name.trim(),
              aliases: [],
              relation: relation.trim().slice(0, 20),
              side: "them",
              mentions: 0,
              evidence: [],
              source: "manual",
              verified: true,
            }]);
            setName("");
            setRelation("");
          }}
        >
          {t("people.add")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={mine.isPending}
          onClick={() => mine.mutate({ personaId, locale: lang })}
        >
          {t("people.mine")}
        </Button>
      </div>
    </section>
  );
}

function StancesEditor({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const lang = locale === "en" ? "en" : "zh";
  const { data, refetch, isError } = trpc.stance.list.useQuery({ personaId });
  const save = trpc.stance.save.useMutation({
    onSuccess: () => { toast.success(t("imperfection.saved")); refetch(); },
    onError: (e: { message?: string }) => toast.error(e.message),
  });
  const mine = trpc.stance.mine.useMutation({
    onSuccess: (result) => {
      if (!result.stances.length) toast.info(result.hint ?? copy(lang, "labels.stance.minedNone"));
      else toast.success(copy(lang, "labels.stance.mine"));
      refetch();
    },
    onError: (e: { message?: string }) => toast.error(e.message),
  });
  const [topic, setTopic] = useState("");
  const [statement, setStatement] = useState("");
  const [polarity, setPolarity] = useState<StancePolarity>("dislike");
  const stances = normalizeStances(data?.stances);

  function persist(next: Stance[]) {
    save.mutate({ personaId, stances: next });
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("stances.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("stances.hint")}</p>
        {data?.hint ? <p className="text-[11px] text-muted-subtle">{data.hint}</p> : null}
      </header>
      {isError ? <p className="text-xs text-destructive" role="alert">{t("common.error")}</p> : null}
      {stances.length === 0 ? (
        <p className="text-xs text-muted-subtle">{t("stances.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {stances.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3 space-y-1.5">
              <p className="text-sm">
                <span className="font-medium">{row.topic}</span>
                <span className="text-muted-foreground"> · {String(t(POLARITY_LABEL[row.polarity]))}</span>
              </p>
              <p className="text-xs text-muted-foreground">{row.statement}</p>
              <div className="flex flex-wrap gap-2">
                {!row.verified ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => persist(stances.map((item) => item.id === row.id ? { ...item, verified: true } : item))}
                    >
                      {t("stances.confirm")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => persist(stances.filter((item) => item.id !== row.id))}
                    >
                      {t("stances.reject")}
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-subtle">{t("stances.verified")}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t("stances.topic")}
          maxLength={80}
        />
        <select
          value={polarity}
          onChange={(e) => setPolarity(e.target.value as StancePolarity)}
          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          aria-label={t("stances.topic")}
        >
          {STANCE_POLARITIES.map((item) => (
            <option key={item} value={item}>{String(t(POLARITY_LABEL[item]))}</option>
          ))}
        </select>
        <Input
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder={t("stances.statement")}
          maxLength={240}
        />
        <Button
          size="sm"
          disabled={!topic.trim() || !statement.trim() || save.isPending}
          onClick={() => {
            persist([...stances, {
              id: nextId("manual"),
              topic: topic.trim(),
              polarity,
              statement: statement.trim(),
              evidence: [],
              source: "manual",
              verified: true,
            }]);
            setTopic("");
            setStatement("");
          }}
        >
          {t("stances.add")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={mine.isPending}
          onClick={() => mine.mutate({ personaId, locale: lang })}
        >
          {t("stances.mine")}
        </Button>
      </div>
    </section>
  );
}
