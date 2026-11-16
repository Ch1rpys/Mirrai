import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * A short list of tags the user types one by one.
 *
 * The add control is a labelled button, and each remove control is at
 * least twenty-four pixels across, so a screen reader and a finger can
 * both hit them.
 */
export default function TagInput({
  tags,
  onChange,
  id,
  label,
  placeholder,
  reject,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** The name of the field, so a screen reader knows what is being typed. */
  id: string;
  label: string;
  placeholder?: string;
  /** Return true to skip adding this value. */
  reject?: (value: string) => boolean;
}) {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (!v || tags.includes(v)) return;
    if (reject?.(v)) return;
    onChange([...tags, v]);
    setInput("");
  };
  return (
    <div className="space-y-2.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-border bg-card text-foreground/80">
              {tag}
              <button onClick={() => onChange(tags.filter((_, j) => j !== i))}
                aria-label={`${label}: ${tag}`}
                /**
                 * The button is big enough to hit.
                 *
                 * It was a twelve-pixel cross with nothing around it —
                 * so the thing that removes a tag was the smallest
                 * thing on the screen, and it was hard to hit on a
                 * touch screen and hard to hit at all with a hand
                 * that shakes. The target is now at least twenty-four
                 * pixels across, which is what the accessibility rules
                 * ask for.
                 *
                 * The size is set in the style, so it does not depend
                 * on a class that a later change could quietly shrink.
                 */
                style={{ minWidth: "1.5rem", minHeight: "1.5rem" }}
                className="text-muted-foreground hover:text-destructive transition-colors inline-flex items-center justify-center w-6 h-6 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input id={id} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          aria-label={label}
          placeholder={placeholder ?? t("personaEdit.tagPlaceholder")} className="h-8 text-sm flex-1" />
        <Button size="sm" variant="ghost" onClick={add} className="h-8 px-2 rounded-md"
          /**
           * The button says what it does.
           *
           * It had the same name as the field beside it — so a screen
           * reader announced a text field and a button, both called
           * 「口头禅」, with nothing to say that the button adds a tag.
           */
          aria-label={t("personaEdit.addTag", { label })}>
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
