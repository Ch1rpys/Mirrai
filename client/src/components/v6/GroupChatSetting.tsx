import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/**
 * The group-chat switch (C9.8).
 *
 * Group chat is experimental and off until the user turns it on here.
 * The switch lives in the profile tab's 实验功能 section; the lobby's
 * entry only appears once `auth.me` says the feature is on.
 *
 * The value is read off the signed-in user, so the switch is a
 * reflection of the account rather than local state: after a save the
 * user is refreshed, and a failed save is said out loud instead of
 * leaving the switch looking like it worked.
 */
export default function GroupChatSetting() {
  const { t } = useLocale();
  const { user, refresh } = useAuth();
  /**
   * A missing `features` object means "off", never "crashed".
   *
   * Older sessions, a test fixture, or a server that has not run the
   * migration yet all reach this component without the field.
   */
  const enabled = (user as { features?: { groupChat?: boolean } } | null)?.features?.groupChat ?? false;
  const update = trpc.user.updateFeatures.useMutation({
    onSuccess: () => {
      toast.success(t("settings.profile.groupChatSaved"));
      // `auth.me` carries the flags, so the switch only moves once the
      // refresh has answered.
      void refresh?.();
    },
    onError: () => {
      toast.error(t("settings.profile.groupChatFailed"));
    },
  });

  return (
    <section className="surface p-5 sm:p-6" data-testid="group-chat-setting">
      <h3 className="font-display text-base text-foreground">
        {t("settings.profile.experimentalTitle")}
      </h3>
      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
        {t("settings.profile.experimentalNote")}
      </p>

      <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <p id="group-chat-switch-label" className="text-sm text-foreground">
            {t("settings.profile.groupChatSwitch")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {t("settings.profile.groupChatNote")}
          </p>
        </div>
        <Switch
          aria-labelledby="group-chat-switch-label"
          checked={enabled}
          disabled={update.isPending}
          onCheckedChange={(next) => {
            update.mutate({ patch: { groupChat: next } });
          }}
        />
      </div>
    </section>
  );
}
