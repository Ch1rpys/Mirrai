/**
 * Sharing a persona with family (C7.2).
 *
 * The owner sends a one-time link. The person who accepts gets their
 * own row: their own conversations, mood and letters, and the same
 * persona data read from the owner. The dialog says exactly what the
 * other side can and cannot see before anything is sent.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ShareSettings({
  personaId,
  name,
}: {
  personaId: number;
  name: string;
}) {
  const { t } = useLocale();
  const persona = trpc.persona.get.useQuery({ id: personaId });
  const shares = trpc.share.list.useQuery(
    { personaId },
    { enabled: Boolean(persona.data) && !persona.data?.sharedFromPersonaId },
  );
  const [link, setLink] = useState<string | null>(null);

  const invite = trpc.share.invite.useMutation({
    onSuccess: (data: { link: string }) => {
      const url = `${window.location.origin}${data.link}`;
      setLink(url);
      toast.success(t("share.invited"));
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = trpc.share.revoke.useMutation({
    onSuccess: () => {
      toast.success(t("share.revoked"));
      shares.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  if (persona.isLoading) return null;
  if (!persona.data) return null;

  /**
   * The member side: the row is theirs, the persona is not. They can
   * stop using it, and everyone else's share is not their business.
   */
  if (persona.data.sharedFromPersonaId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("share.memberNote", { name })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="section-title">{t("share.entry")}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("share.dialogNote", { name })}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={invite.isPending}
        onClick={() => invite.mutate({ personaId })}
      >
        {t("share.invite")}
      </Button>

      {link && (
        <div className="rounded-md border border-border/70 p-3 space-y-1.5">
          <p className="text-xs text-muted-foreground">{t("share.inviteLink")}</p>
          <code className="block text-[0.6875rem] break-all text-foreground">{link}</code>
        </div>
      )}

      {(shares.data ?? []).length > 0 && (
        <ul className="space-y-2">
          {(shares.data ?? []).map((share: any) => (
            <li
              key={share.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-xs"
            >
              <span className="text-muted-foreground">
                {share.status === "active" ? t("share.memberJoined") : t("share.memberInvited")}
              </span>
              {share.status !== "revoked" && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => revoke.mutate({ id: share.id })}
                >
                  {t("share.stop")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
