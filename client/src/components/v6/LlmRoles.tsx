import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

const ROLE_KEYS = ["classify", "extract", "summarize"] as const;
const ROLE_LABEL: Record<(typeof ROLE_KEYS)[number], "settings.ai.rolesClassify" | "settings.ai.rolesExtract" | "settings.ai.rolesSummarize"> = {
  classify: "settings.ai.rolesClassify",
  extract: "settings.ai.rolesExtract",
  summarize: "settings.ai.rolesSummarize",
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none";

/**
 * Cheap-work roles on the default LLM configuration.
 *
 * Replies stay on the persona's model. Mood, memories and summaries
 * can point at a cheaper one.
 */
export default function LlmRoles() {
  const { t } = useLocale();
  const providers = trpc.llmConfig.listProviders.useQuery();
  const defaultConfig = trpc.llmConfig.getDefault.useQuery();
  const update = trpc.llmConfig.updateExtraConfig.useMutation({
    onSuccess: () => {
      toast.success(t("settings.ai.rolesSaved"));
      defaultConfig.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const [roles, setRoles] = useState<Record<(typeof ROLE_KEYS)[number], string>>({
    classify: "",
    extract: "",
    summarize: "",
  });

  useEffect(() => {
    const saved = (defaultConfig.data?.extraConfig as { roles?: Record<string, string> } | undefined)?.roles;
    setRoles({
      classify: saved?.classify ?? "",
      extract: saved?.extract ?? "",
      summarize: saved?.summarize ?? "",
    });
  }, [defaultConfig.data]);

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.ai.rolesTitle")}
        </h2>
        <p className="kicker mt-1.5">{t("settings.ai.rolesNote")}</p>
      </div>
      <div className="space-y-3">
        {ROLE_KEYS.map((key) => (
          <label key={key} className="block space-y-1.5">
            <span className="text-sm text-foreground/80">{t(ROLE_LABEL[key])}</span>
            <select
              className={selectClass}
              value={roles[key]}
              onChange={(event) => setRoles((current) => ({ ...current, [key]: event.target.value }))}
              disabled={!defaultConfig.data}
            >
              <option value="">{t("settings.ai.rolesDefault")}</option>
              {(providers.data ?? []).map((provider) => (
                <option key={provider.name} value={provider.name}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <Button
          size="sm"
          className="rounded-md px-5"
          disabled={!defaultConfig.data || update.isPending}
          onClick={() => {
            const next: Record<string, string> = {};
            for (const key of ROLE_KEYS) {
              if (roles[key].trim()) next[key] = roles[key].trim();
            }
            update.mutate({ extraConfig: { roles: next } });
          }}
        >
          {update.isPending ? t("common.saving") : t("settings.ai.saveRoles")}
        </Button>
      </div>
    </section>
  );
}
