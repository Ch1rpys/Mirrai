/**
 * Timestamp-then-body exports (WeChat TXT, QQ TXT): a header line names
 * the clock and the speaker, the following lines are the message, and a
 * blank line or the next header ends it.
 */
import type { ParsedRecord, RecordKind } from "@shared/records";
import {
  applyTextPlaceholder,
  cappedWarnings,
  collectSpeakers,
  parseExportTime,
  yieldToEventLoop,
} from "../normalize";
import type { ParseResult, ParseWarning } from "../types";

export interface BlockHeader {
  time: string;
  speaker: string;
  kind?: RecordKind;
  /** Text that already sat on the header line. */
  content?: string;
}

export async function parseNameTimeBlocks(
  text: string,
  options: {
    timeZone?: string | null;
    matchHeader: (line: string) => BlockHeader | null;
    isPreamble?: (line: string) => boolean;
  },
): Promise<ParseResult> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const records: ParsedRecord[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let current: ParsedRecord | null = null;
  const body: string[] = [];

  const flush = () => {
    if (!current) return;
    current.content = body.join("\n").trim();
    if (current.content) records.push(applyTextPlaceholder(current));
    else skipped += 1;
    current = null;
    body.length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const lineNo = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      // A blank line between a header and its first body line is padding
      // (HTML `</div><div>` turns into one). A blank after some body ends
      // the message, which is how the TXT exporters separate blocks.
      if (current && body.length > 0) flush();
      continue;
    }
    if (options.isPreamble?.(trimmed)) {
      skipped += 1;
      continue;
    }
    const header = options.matchHeader(trimmed);
    if (header) {
      flush();
      current = {
        speaker: header.speaker,
        content: "",
        timestamp: parseExportTime(header.time, options.timeZone),
        kind: header.kind ?? "text",
        lineNo,
      };
      if (header.content) body.push(header.content);
      continue;
    }
    if (current) {
      body.push(raw.replace(/\s+$/, ""));
      continue;
    }
    skipped += 1;
    warnings.push({ code: "skipped_line", lineNo, detail: trimmed.slice(0, 80) });
  }
  flush();

  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}
