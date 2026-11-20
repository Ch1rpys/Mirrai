/**
 * The fingerprint in words (C2.9)
 *
 * The manual is read by a person, not by a model. So the numbers of the
 * fingerprint become a few plain sentences, each one still traceable to
 * the number it came from.
 */
import { copy, type Locale } from "./copy";
import type { StyleFingerprint } from "./style-fingerprint";

export interface ProseLine {
  /** The sentence a person reads. */
  text: string;
  /** The measurement behind it. */
  metric: string;
  value: number;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// i18n:allow-identifier — 「呢」 is the fingerprint's own particle key, not copy.
export function describeFingerprint(
  fingerprint: StyleFingerprint | null | undefined,
  locale: Locale = "zh",
): ProseLine[] {
  if (!fingerprint) return [];
  const lines: ProseLine[] = [];
  const period = fingerprint.endings?.period ?? 0;
  const distantPeriod = fingerprint.perState?.distant?.endings?.period ?? 0;
  if (period < 0.1 && distantPeriod > 0.5) {
    lines.push({
      text: copy(locale, "fingerprintProse.neverPeriodUpset"),
      metric: "endings.period / perState.distant.endings.period",
      value: period,
    });
  } else if (period > 0.5) {
    lines.push({
      text: copy(locale, "fingerprintProse.periodOften", { percent: pct(period) }),
      metric: "endings.period",
      value: period,
    });
  } else if (period < 0.05) {
    lines.push({
      text: copy(locale, "fingerprintProse.neverPeriod"),
      metric: "endings.period",
      value: period,
    });
  }

  const ellipsis = fingerprint.endings?.ellipsis ?? 0;
  if (ellipsis > 0.05) {
    lines.push({
      text: copy(locale, "fingerprintProse.ellipsisEnd", { percent: pct(ellipsis) }),
      metric: "endings.ellipsis",
      value: ellipsis,
    });
  }

  const particles = fingerprint.particles ?? {};
  const topParticle = Object.entries(particles)
    .filter(([key]) => key !== "none")
    .sort((a, b) => b[1] - a[1])[0];
  if (topParticle && topParticle[1] >= 0.15) {
    lines.push({
      text: copy(locale, "fingerprintProse.particleEnd", {
        particle: topParticle[0],
        percent: pct(topParticle[1]),
      }),
      metric: `particles.${topParticle[0]}`,
      value: topParticle[1],
    });
  }
  if ((particles["呢"] ?? 0) === 0) {
    lines.push({
      text: copy(locale, "fingerprintProse.neverParticle", { particle: "呢" }),
      metric: "particles.呢",
      value: 0,
    });
  }

  const median = fingerprint.length?.median ?? 0;
  if (median > 0 && median <= 12) {
    lines.push({
      text: copy(locale, "fingerprintProse.shortLines", { n: median }),
      metric: "length.median",
      value: median,
    });
  }

  const emoji = fingerprint.emoji?.rate ?? 0;
  if (emoji === 0) {
    lines.push({
      text: copy(locale, "fingerprintProse.noEmoji"),
      metric: "emoji.rate",
      value: 0,
    });
  }

  const laugh = fingerprint.laugh?.rate ?? 0;
  if (laugh > 0.05) {
    lines.push({
      text: copy(locale, "fingerprintProse.laughOften", { percent: pct(laugh) }),
      metric: "laugh.rate",
      value: laugh,
    });
  }

  return lines;
}
