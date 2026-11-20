/**
 * The recordings are the main door for a memorial persona (C7.3).
 *
 * Nothing here is synthesised. For someone who has died, their own
 * recordings are the part of the app that is still them, so the chat
 * page and the profile put the door first — but only in memorial mode.
 */
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Headphones } from "lucide-react";

export default function VoicesEntry({
  personaId,
  name,
  memorial,
}: {
  personaId: number;
  name: string;
  memorial: boolean;
}) {
  const [, navigate] = useLocation();
  const { t } = useLocale();
  if (!memorial) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => navigate(`/persona/${personaId}/voices`)}
    >
      <Headphones className="w-3.5 h-3.5" />
      {t("media.voicesEntry", { name })}
    </Button>
  );
}
