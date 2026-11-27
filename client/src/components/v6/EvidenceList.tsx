import { useState } from "react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { formatDayKey } from "@/lib/dates";
import {
  fieldIsInferred,
  type EvidenceByDimension,
  type EvidenceCard,
  type EvidenceField,
  cardsForField,
} from "@shared/evidence-map";

/**
 * The quoted lines a portrait layer was read from.
 *
 * A layer with no cards is a model's summary. The mark says so, instead
 * of leaving a blank that looks like certainty.
 *
 * A quote is a link into the reader (C2.10's `?at=<recordId>`), so a
 * person who doubts a summary can read the line it came from (B1.8,
 * B7.3).
 */
export default function EvidenceList(props: {
  field: EvidenceField;
  dimensions: EvidenceByDimension | null | undefined;
  /** The persona whose record the quoted lines live in. */
  personaId: number;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const cards = cardsForField(props.field, props.dimensions);
  const inferred = fieldIsInferred(props.field, props.dimensions);

  if (inferred) {
    return (
      <span
        className="ml-2 text-[11px] text-muted-foreground"
        title={t("evidence.inferredHint")}
      >
        {t("evidence.inferred")}
      </span>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs underline underline-offset-2 text-muted-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        {t("evidence.toggle", { count: cards.length })}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {cards.map((card, index) => (
            <EvidenceCardItem
              key={`${card.claim}:${index}`}
              card={card}
              locale={locale}
              personaId={props.personaId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceCardItem(props: { card: EvidenceCard; locale: string; personaId: number }) {
  return (
    <li className="text-sm text-muted-foreground leading-relaxed">
      <p>{props.card.claim}</p>
      {props.card.quotes.map((quote) => {
        const day = quote.day ?? (quote.at ? quote.at.slice(0, 10) : "");
        const when = day ? formatDayKey(day, props.locale) : "";
        return (
          <p key={quote.recordId} className="mt-1 text-xs">
            {when ? `${when} · ` : ""}
            {quote.speaker ? `${quote.speaker} · ` : ""}
            <Link
              href={`/persona/${props.personaId}/records?at=${quote.recordId}`}
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              title={quote.text}
            >
              {quote.text}
            </Link>
          </p>
        );
      })}
    </li>
  );
}
