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
import type { ParsedRecord, RecordKind } from "@shared/records";
import {
  applyTextPlaceholder,
  cappedWarnings,
  collectSpeakers,
  looksLikeSqlite,
  looksLikeZip,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult } from "../types";

/**
 * Native chat.db flags → kind. Checked 2026-11-16 against
 * [macfor chat.db](https://kb.macfor.io/docs/communication/messages/chat-database)
 * and [imessage-chatdb](https://pypi.org/project/imessage-chatdb/):
 * `is_audio_message`, `associated_message_type` 1000 (sticker),
 * URL balloon, attachments via `message_attachment_join`.
 */
const IMESSAGE_KIND: Record<string, RecordKind> = {
  audio: "voice",
  sticker: "sticker",
  link: "link",
  image: "image",
  video: "video",
  file: "file",
};

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

function imessageKind(row: {
  isAudio?: number | bigint;
  associatedType?: number | bigint;
  balloon?: string | null;
  mime?: string | null;
  isSticker?: number | bigint;
  attachName?: string | null;
}): { kind: RecordKind; content?: string; meta?: Record<string, unknown> } | null {
  if (Number(row.isAudio ?? 0) === 1) {
    return { kind: IMESSAGE_KIND.audio, content: "[voice]" };
  }
  if (Number(row.associatedType ?? 0) === 1000 || Number(row.isSticker ?? 0) === 1) {
    return { kind: IMESSAGE_KIND.sticker, content: "[sticker]" };
  }
  if (typeof row.balloon === "string" && row.balloon.includes("URLBalloonProvider")) {
    return { kind: IMESSAGE_KIND.link, content: "[link]" };
  }
  const mime = (row.mime ?? "").toLowerCase();
  const name = row.attachName ?? "";
  if (mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(name)) {
    return { kind: IMESSAGE_KIND.image, content: "[image]", meta: name ? { path: name } : undefined };
  }
  if (mime.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(name)) {
    return { kind: IMESSAGE_KIND.video, content: "[video]", meta: name ? { path: name } : undefined };
  }
  if (mime.startsWith("audio/")) {
    return { kind: IMESSAGE_KIND.voice, content: "[voice]", meta: name ? { path: name } : undefined };
  }
  if (name || mime) {
    return { kind: IMESSAGE_KIND.file, content: name ? `[file:${name}]` : "[file]", meta: name ? { name } : undefined };
  }
  return null;
}

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

      const cols = tableColumns(db, "message");
      const attachCols = tableColumns(db, "attachment");
      const extra = [
        cols.has("is_audio_message") ? "m.is_audio_message AS isAudio" : "0 AS isAudio",
        cols.has("associated_message_type")
          ? "m.associated_message_type AS associatedType"
          : "0 AS associatedType",
        cols.has("balloon_bundle_id") ? "m.balloon_bundle_id AS balloon" : "NULL AS balloon",
      ].join(", ");
      const attachSelect = attachCols.size
        ? `, a.mime_type AS mime, a.transfer_name AS attachName, a.is_sticker AS isSticker`
        : `, NULL AS mime, NULL AS attachName, 0 AS isSticker`;
      const attachJoin = attachCols.size
        ? ` LEFT JOIN message_attachment_join maj ON maj.message_id = m.ROWID
            LEFT JOIN attachment a ON a.ROWID = maj.attachment_id`
        : "";
      const sql = options.chatId
        ? `SELECT m.ROWID AS id, m.text AS text, m.attributedBody AS attributedBody,
                  m.is_from_me AS isFromMe, m.date AS date, h.id AS handle, ${extra}${attachSelect}
           FROM message m
           LEFT JOIN handle h ON h.ROWID = m.handle_id
           JOIN chat_message_join j ON j.message_id = m.ROWID
           ${attachJoin}
           WHERE j.chat_id = ?
           ORDER BY m.date ASC, m.ROWID ASC`
        : `SELECT m.ROWID AS id, m.text AS text, m.attributedBody AS attributedBody,
                  m.is_from_me AS isFromMe, m.date AS date, h.id AS handle, ${extra}${attachSelect}
           FROM message m
           LEFT JOIN handle h ON h.ROWID = m.handle_id
           ${attachJoin}
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
        isAudio?: number | bigint;
        associatedType?: number | bigint;
        balloon?: string | null;
        mime?: string | null;
        attachName?: string | null;
        isSticker?: number | bigint;
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
        const native = imessageKind(row);
        if (!text && !native) {
          skipped += 1;
          continue;
        }
        const fromMe = Number(row.isFromMe) === 1;
        const parsed: ParsedRecord = {
          speaker: row.handle?.trim() || (fromMe ? "me" : "them"),
          fromMe,
          content: native?.content ?? text,
          timestamp: appleToDate(row.date),
          kind: native?.kind ?? "text",
          lineNo: Number(row.id),
          sourceId: String(row.id),
          meta: native?.meta,
        };
        records.push(parsed.kind === "text" ? applyTextPlaceholder(parsed) : parsed);
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
