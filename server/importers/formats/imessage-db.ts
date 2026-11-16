/**
 * macOS Messages `chat.db`.
 *
 * Checked 2026-11-16 against documented schema
 * ([imessage-exporter-redux SCHEMA](https://github.com/grioghar/imessage-exporter-redux/blob/main/docs/SCHEMA.md)):
 * `message.text` / `attributedBody` (typedstream NSString), `is_from_me`,
 * `date` as nanoseconds since 2001-01-01, `handle`, `chat`,
 * `chat_message_join`. Read with `node:sqlite`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { copy } from "@shared/copy";
import type { ParsedRecord } from "@shared/records";
import { cappedWarnings, collectSpeakers, looksLikeSqlite, looksLikeZip } from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult } from "../types";

const APPLE_EPOCH = 978_307_200;

function appleToDate(raw: number | bigint): Date | null {
  try {
    const ns = typeof raw === "bigint" ? raw : BigInt(Math.trunc(raw));
    if (ns <= 0n) return null;
    const seconds = ns > 1_000_000_000_000n ? ns / 1_000_000_000n : ns;
    return new Date(Number(seconds + BigInt(APPLE_EPOCH)) * 1000);
  } catch {
    return null;
  }
}

function typedstreamLen(buf: Uint8Array, i: { at: number }): number | null {
  if (i.at >= buf.length) return null;
  const tag = buf[i.at]!;
  i.at += 1;
  if (tag <= 0x7f) return tag;
  if (tag === 0x81) {
    if (i.at + 2 > buf.length) return null;
    const n = buf[i.at]! | (buf[i.at + 1]! << 8);
    i.at += 2;
    return n;
  }
  if (tag === 0x82) {
    if (i.at + 4 > buf.length) return null;
    const n = buf[i.at]! | (buf[i.at + 1]! << 8) | (buf[i.at + 2]! << 16) | (buf[i.at + 3]! << 24);
    i.at += 4;
    return n;
  }
  return null;
}

export function parseAttributedBody(blob: Uint8Array | null | undefined): string {
  if (!blob || blob.length === 0) return "";
  const marker = Buffer.from("NSString");
  const start = Buffer.from(blob).indexOf(marker);
  if (start < 0) return "";
  let at = start + marker.length;
  while (at < blob.length && blob[at] !== 0x2b) at += 1;
  if (at >= blob.length) return "";
  at += 1;
  const cursor = { at };
  const len = typedstreamLen(blob, cursor);
  if (len == null || cursor.at + len > blob.length) return "";
  try {
    return Buffer.from(blob.subarray(cursor.at, cursor.at + len)).toString("utf8");
  } catch {
    return "";
  }
}

async function withSqlite<T>(bytes: Uint8Array, fn: (db: DatabaseSync) => T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mirrai-imessage-"));
  const path = join(dir, "chat.db");
  try {
    await writeFile(path, bytes);
    const opened = new DatabaseSync(path, { readOnly: true, readBigInts: true });
    try {
      return fn(opened);
    } finally {
      opened.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function parseImessageDb(bytes: Uint8Array, options: ParseOptions = {}): Promise<ParseResult> {
  try {
    return await withSqlite(bytes, (db) => {
      const chats = db
        .prepare(
          `SELECT c.ROWID AS id, COALESCE(c.display_name, c.chat_identifier, '') AS title,
                  COUNT(j.message_id) AS count
           FROM chat c
           LEFT JOIN chat_message_join j ON j.chat_id = c.ROWID
           GROUP BY c.ROWID`,
        )
        .all() as Array<{ id: number; title: string; count: number }>;

      const sql = options.chatId
        ? `SELECT m.ROWID AS id, m.text AS text, m.attributedBody AS attributedBody,
                  m.is_from_me AS isFromMe, m.date AS date, h.id AS handle
           FROM message m
           LEFT JOIN handle h ON h.ROWID = m.handle_id
           JOIN chat_message_join j ON j.message_id = m.ROWID
           WHERE j.chat_id = ?
           ORDER BY m.date ASC, m.ROWID ASC`
        : `SELECT m.ROWID AS id, m.text AS text, m.attributedBody AS attributedBody,
                  m.is_from_me AS isFromMe, m.date AS date, h.id AS handle
           FROM message m
           LEFT JOIN handle h ON h.ROWID = m.handle_id
           ORDER BY m.date ASC, m.ROWID ASC`;
      const rows = (
        options.chatId ? db.prepare(sql).all(Number(options.chatId)) : db.prepare(sql).all()
      ) as Array<{
        id: number;
        text: string | null;
        attributedBody: Uint8Array | null;
        isFromMe: number;
        date: number | bigint;
        handle: string | null;
      }>;

      const records: ParsedRecord[] = [];
      let skipped = 0;
      for (const row of rows) {
        const blob = row.attributedBody
          ? row.attributedBody instanceof Uint8Array
            ? row.attributedBody
            : Buffer.from(row.attributedBody as ArrayBuffer)
          : null;
        const text = (row.text && String(row.text).trim()) || parseAttributedBody(blob);
        if (!text) {
          skipped += 1;
          continue;
        }
        const fromMe = Number(row.isFromMe) === 1;
        records.push({
          speaker: row.handle?.trim() || (fromMe ? "me" : "them"),
          fromMe,
          content: text,
          timestamp: appleToDate(Number(row.date)),
          kind: "text",
          lineNo: Number(row.id),
          sourceId: String(row.id),
        });
      }
      return {
        records,
        speakers: collectSpeakers(records),
        chats:
          chats.length > 1
            ? chats.map((chat) => ({
                id: String(chat.id),
                title: chat.title || String(chat.id),
                count: Number(chat.count),
              }))
            : undefined,
        warnings: cappedWarnings([]),
        skipped,
      };
    });
  } catch {
    return { records: [], speakers: [], warnings: [{ code: "invalid_sqlite" }], skipped: 1 };
  }
}

function detectImessageDb(source: ImportSource): DetectResult | null {
  if (!looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  const head = Buffer.from(source.bytes.subarray(0, Math.min(source.bytes.length, 16_000))).toString("latin1");
  if (!head.includes("attributedBody") && !head.includes("is_from_me")) return null;
  return { id: "imessage-db", confidence: 0.9 };
}

export const imessageDbImporter: Importer = {
  id: "imessage-db",
  label: {
    zh: copy("zh", "import.format.imessageDb"),
    en: copy("en", "import.format.imessageDb"),
  },
  source: "imessage",
  detect: detectImessageDb,
  parse(source, options) {
    return parseImessageDb(source.bytes, options);
  },
};
