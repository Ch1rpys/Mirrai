import { useLocale } from "@/contexts/LocaleContext";

/**
 * One line on a persona's card: something arrived while the user was
 * away (C8.2).
 *
 * It is the quiet version of the mailbox badge — the same fact, on the
 * card it belongs to, without taking the user anywhere. It only says
 * that a reply came; opening the conversation is how it is read, and
 * that is what clears it.
 */
export default function PersonaUnreadNote({
  name,
  count,
}: {
  name: string;
  count: number;
}) {
  const { t } = useLocale();
  if (!count) return null;
  return (
    <p className="text-[0.6875rem] text-muted-foreground" data-testid="persona-unread-note">
      {t("mailbox.personaLine", { name })}
    </p>
  );
}
