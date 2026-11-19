import { cn } from "@/lib/utils";

const TONES = [
  "bg-mood-warm/18 text-mood-warm",
  "bg-mood-playful/18 text-mood-playful",
  "bg-mood-nostalgic/18 text-mood-nostalgic",
  "bg-mood-melancholy/18 text-mood-melancholy",
  "bg-mood-happy/18 text-mood-happy",
  "bg-muted text-muted-foreground",
];

export function PersonaAvatar({
  name,
  url,
  className,
}: {
  name: string;
  /** A real photograph the user chose (B7.8); the initial is the fallback. */
  url?: string | null;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn("inline-block object-cover select-none", className)}
      />
    );
  }
  const label = name || "?";
  const idx = label.charCodeAt(0) % TONES.length;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center font-sans font-semibold select-none leading-none",
        TONES[idx],
        className
      )}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
