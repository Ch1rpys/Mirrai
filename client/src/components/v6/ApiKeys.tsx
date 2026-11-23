import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { formatInstantInZone } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * The keys of the OpenAI-compatible endpoint (C9.2).
 *
 * A key is shown once, when it is created; after that the list only has
 * the prefix. Creating one is a deliberate act — the endpoint does
 * nothing at all until the first key exists.
 */
type Scope = "chat" | "read";

export default function ApiKeys() {
  const { t, locale } = useLocale();
  const keys = trpc.apiKey.list.useQuery();
  const create = trpc.apiKey.create.useMutation();
  const revoke = trpc.apiKey.revoke.useMutation();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["chat"]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  function toggleScope(scope: Scope, on: boolean) {
    setScopes((prev) => {
      const next = on ? [...new Set([...prev, scope])] : prev.filter((item) => item !== scope);
      return next.length > 0 ? next : prev;
    });
  }

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    try {
      const result = await create.mutateAsync({ name: trimmed, scopes });
      setFresh(result.key);
      setName("");
      await keys.refetch();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function onCopy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      toast.success(t("apiKeys.copied"));
    } catch {
      toast.error(t("apiKeys.copyFailed"));
    }
  }

  async function onRevoke(id: number) {
    try {
      await revoke.mutateAsync({ id });
      setConfirming(null);
      await keys.refetch();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="section-title">{t("apiKeys.title")}</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("apiKeys.note")}</p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("apiKeys.namePlaceholder")}
            aria-label={t("apiKeys.nameLabel")}
            className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={scopes.includes("chat")}
              onChange={(event) => toggleScope("chat", event.target.checked)}
              className="mt-0.5"
            />
            {t("apiKeys.scopeChat")}
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={scopes.includes("read")}
              onChange={(event) => toggleScope("read", event.target.checked)}
              className="mt-0.5"
            />
            {t("apiKeys.scopeRead")}
          </label>
          <Button
            size="sm"
            className="rounded-md px-4"
            onClick={() => void onCreate()}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? t("common.saving") : t("apiKeys.create")}
          </Button>
        </div>

        {fresh && (
          <div className="rounded-md border border-border/70 bg-muted/30 p-3 space-y-2" data-testid="api-key-fresh">
            <p className="text-xs text-muted-foreground">{t("apiKeys.createdOnce")}</p>
            <div className="flex items-center gap-2">
              <code className="text-xs break-all rounded-sm bg-background px-2 py-1 flex-1">{fresh}</code>
              <Button size="sm" variant="outline" className="rounded-md bg-transparent" onClick={() => void onCopy(fresh)}>
                {t("apiKeys.copy")}
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">{t("apiKeys.lockNote")}</p>

        {keys.isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        {keys.isError && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{t("apiKeys.loadFailed")}</p>
            <Button size="sm" variant="ghost" onClick={() => void keys.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {!keys.isLoading && !keys.isError && (keys.data?.keys.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="api-keys-empty">{t("apiKeys.empty")}</p>
        )}

        <ul className="space-y-2">
          {keys.data?.keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
              <span className="font-medium">{key.name}</span>
              <code className="text-xs text-muted-foreground">{key.prefix}…</code>
              <span className="text-[11px] text-muted-foreground">
                {key.scopes.map((scope) => t(scope === "read" ? "apiKeys.scopeRead" : "apiKeys.scopeChat")).join(" · ")}
              </span>
              <span className="text-[11px] text-muted-subtle">
                {key.lastUsedAt
                  ? t("apiKeys.lastUsed", { date: formatInstantInZone(key.lastUsedAt, locale) })
                  : t("apiKeys.neverUsed")}
              </span>
              {key.revokedAt ? (
                <span className="text-[11px] text-muted-subtle">{t("apiKeys.revoked")}</span>
              ) : confirming === key.id ? (
                <span className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="rounded-md bg-transparent" onClick={() => void onRevoke(key.id)}>
                    {t("apiKeys.revokeConfirm")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {t("common.cancel")}
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  onClick={() => setConfirming(key.id)}
                >
                  {t("apiKeys.revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
