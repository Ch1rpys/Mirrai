import { useLocale } from "@/contexts/LocaleContext";

/**
 * The fidelity panel says when there is nothing to compare (C1.8).
 *
 * A persona written from somebody's description has no held-back original
 * lines, so the "how close is it" ruler has nothing to measure. Showing
 * the usual "not measured yet — import more of the conversation" would be
 * a promise to measure something this persona can never have; this
 * sentence says the true thing instead.
 */
export default function DescribedFidelityNote({ name }: { name: string }) {
  const { t } = useLocale();
  return (
    <p className="text-xs text-muted-foreground" data-testid="fidelity-described">
      {t("fidelity.described", { name })}
    </p>
  );
}
