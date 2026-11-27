/**
 * What the app worked out (C10.6).
 *
 * Two blocks: one about the user, one about each persona. Every row says
 * where it came from, and the rows that can be dealt with have the
 * action for it — delete a memory, reject a candidate, stop using a
 * measurement, or go and edit the persona. The row expands to show the
 * content and the evidence behind it.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { copy } from "@shared/copy";
import PageLoader from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { InferenceItem, InferenceSection, InferenceSource } from "../../../server/inference/list";
import type { StyleProfileKey } from "@shared/style-profile";

const SOURCE_OF: Record<InferenceSource, "inference.source.measured" | "inference.source.mined" | "inference.source.confirmed" | "inference.source.written"> = {
  measured: "inference.source.measured",
  mined: "inference.source.mined",
  confirmed: "inference.source.confirmed",
  written: "inference.source.written",
};

function sourceClass(source: InferenceSource): string {
  if (source === "measured") return "border-border/70 text-muted-foreground";
  if (source === "mined") return "border-amber-500/40 text-amber-700 dark:text-amber-400";
  if (source === "confirmed") return "border-emerald-500/40 text-emerald-700 dark:text-emerald-400";
  return "border-primary/40 text-primary";
}

function personaIdOf(section: InferenceSection): number | null {
  if (!section.id.startsWith("persona-")) return null;
  const id = Number.parseInt(section.id.slice("persona-".length), 10);
  return Number.isInteger(id) ? id : null;
}

/** The style profile keys a persona has turned off, from its own rows. */
function disabledProfilesOf(section: InferenceSection): StyleProfileKey[] {
  return section.items.flatMap((item) => (
    item.action?.kind === "toggleStyleKey" && item.disabled ? [item.action.styleKey] : []
  ));
}

function InferenceRow({
  item,
  section,
  onChanged,
}: {
  item: InferenceItem;
  section: InferenceSection;
  onChanged: () => void;
}) {
  const { t, locale } = useLocale();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const deleteMemory = trpc.memory.delete.useMutation({
    onSuccess: () => {
      toast.success(copy(locale, "inference.action.deleteMemory"));
      onChanged();
    },
    onError: (error) => toast.error(error.message),
  });
  const rejectCandidate = trpc.inference.rejectCandidate.useMutation({
    onSuccess: () => {
      toast.success(copy(locale, "inference.action.reject"));
      onChanged();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateSettings = trpc.persona.updateSettings.useMutation({
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(error.message),
  });

  const action = item.action;
  const personaId = personaIdOf(section);
  const label = copy(locale, item.labelKey, item.labelParams);
  const sourceLabel = copy(locale, SOURCE_OF[item.source]);
  const hasDetail = Boolean(item.detail || (item.evidence && item.evidence.length > 0));

  function runAction() {
    if (!action) return;
    if (action.kind === "deleteMemory") {
      deleteMemory.mutate({ id: action.memoryId });
      return;
    }
    if (action.kind === "rejectCandidate") {
      if (!personaId) return;
      rejectCandidate.mutate({
        personaId,
        candidateKind: action.candidateKind,
        key: action.key,
      });
      return;
    }
    if (action.kind === "toggleStyleKey") {
      if (!personaId) return;
      const current = new Set(disabledProfilesOf(section));
      if (action.disabled) current.delete(action.styleKey);
      else current.add(action.styleKey);
      updateSettings.mutate({
        id: personaId,
        patch: { disabledProfiles: [...current] },
      });
      return;
    }
    navigate(`/persona/${action.personaId}/edit`);
  }

  function actionLabel(): string {
    if (!action) return "";
    if (action.kind === "deleteMemory") return copy(locale, "inference.action.deleteMemory");
    if (action.kind === "rejectCandidate") return copy(locale, "inference.action.reject");
    if (action.kind === "toggleStyleKey") {
      return action.disabled
        ? copy(locale, "inference.action.enable")
        : copy(locale, "inference.action.disable");
    }
    return copy(locale, "inference.action.editPersona");
  }

  const pending = deleteMemory.isPending || rejectCandidate.isPending || updateSettings.isPending;

  return (
    <li className="border-t border-border/60 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={copy(locale, "inference.detailToggle")}
            className="text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="w-4 h-4" aria-hidden="true" />
        )}
        <span className={`min-w-0 flex-1 text-sm ${item.disabled ? "text-muted-subtle line-through" : "text-foreground"}`}>
          {label}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${sourceClass(item.source)}`}>
          {sourceLabel}
        </span>
        {action && (
          <Button
            size="sm"
            variant={action.kind === "deleteMemory" ? "outline" : "ghost"}
            className={action.kind === "deleteMemory" ? "bg-transparent text-xs" : "text-xs"}
            disabled={pending}
            onClick={runAction}
          >
            {actionLabel()}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 pl-6">
          {item.detail && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/20 p-2.5 text-xs text-foreground/90">
              {item.detail}
            </pre>
          )}
          {item.evidence && item.evidence.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">{copy(locale, "inference.evidence")}</p>
              <ul className="space-y-1">
                {item.evidence.map((line, index) => (
                  <li key={index} className="text-xs text-muted-foreground leading-relaxed">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Inferences() {
  const { t, locale } = useLocale();
  const utils = trpc.useUtils();
  const query = trpc.inference.list.useQuery();

  if (query.isLoading) return <PageLoader />;
  if (query.isError || !query.data) {
    return (
      <div className="container max-w-3xl py-8" role="alert">
        <p className="text-sm text-destructive">{t("common.loadFailed")}</p>
        <Button variant="outline" className="mt-3 bg-transparent" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const sections = query.data.sections as InferenceSection[];
  const me = sections.find((section) => section.id === "me");
  const personas = sections.filter((section) => section.id !== "me");

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div>
        <h1 className="page-title">{copy(locale, "inference.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{copy(locale, "inference.note")}</p>
      </div>

      {me && (
        <section className="surface p-5 sm:p-6">
          <h2 className="section-title">{copy(locale, me.titleKey)}</h2>
          {me.items.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">{copy(locale, "inference.noMeItems")}</p>
          ) : (
            <ul className="mt-2">
              {me.items.map((item) => (
                <InferenceRow
                  key={item.id}
                  item={item}
                  section={me}
                  onChanged={() => void utils.inference.list.invalidate()}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {personas.map((section) => (
        <section key={section.id} className="surface p-5 sm:p-6">
          <h2 className="section-title">{copy(locale, section.titleKey, section.titleParams)}</h2>
          {section.items.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">{copy(locale, "inference.emptyPersona")}</p>
          ) : (
            <ul className="mt-2">
              {section.items.map((item) => (
                <InferenceRow
                  key={item.id}
                  item={item}
                  section={section}
                  onChanged={() => void utils.inference.list.invalidate()}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
