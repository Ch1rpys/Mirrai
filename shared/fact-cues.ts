/**
 * Clues that a block of the record might hold a fact, a person, or a
 * stance. A deep distillation reads every block; the lighter presets
 * only send the blocks that match one of these.
 */

// i18n:allow-input — these match words in the user's records, not sentences the app writes.
const CUES: RegExp[] = [
  /\d+月\d+[日号]/,
  /\d{4}[-/.年]/,
  /生日/,
  /纪念日/,
  /周年/,
  /第一次/,
  /妈/,
  /爸/,
  /室友/,
  /同事/,
  /老板/,
  /闺蜜/,
  /喜欢/,
  /讨厌/,
  /最爱/,
  /受不了/,
  /害怕/,
  /店/,
  /馆/,
  /路/,
  /公园/,
  /学校/,
  /医院/,
  /\bbirthday\b/i,
  /\banniversary\b/i,
  /\bfirst time\b/i,
  /\bmom\b/i,
  /\bdad\b/i,
  /\broommate\b/i,
  /\bcolleague\b/i,
  /\bboss\b/i,
  /\bbest friend\b/i,
  /\blike\b/i,
  /\bhate\b/i,
  /\blove\b/i,
  /can'?t stand/i,
  /\bafraid\b/i,
  /\bshop\b/i,
  /\bcafe\b/i,
  /\broad\b/i,
  /\bpark\b/i,
  /\bschool\b/i,
  /\bhospital\b/i,
];

export function textHasFactCue(text: string): boolean {
  if (!text) return false;
  return CUES.some((cue) => cue.test(text));
}

export function chunkHasFactCue(chunk: { rows: Array<{ content: string }> }): boolean {
  return chunk.rows.some((row) => textHasFactCue(row.content));
}
