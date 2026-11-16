import type { ParsedRecord, RecordKind } from "@shared/records";

export type ImportFormatId =
  | "generic-line"
  | "wechat-txt-2line"
  | "wechat-txt-paren"
  | "wechat-csv"
  | "wechat-json"
  | "qq-txt"
  | "telegram-json";

export type ImportSourceName =
  | "wechat_export"
  | "qq"
  | "telegram"
  | "whatsapp"
  | "line"
  | "kakao"
  | "meta"
  | "discord"
  | "sms"
  | "imessage"
  | "generic";

export interface ImportSource {
  fileName: string;
  bytes: Uint8Array;
  /** Decoded text. Empty for a binary file the decoder could not read. */
  text: string;
}

export interface DetectResult {
  id: ImportFormatId;
  confidence: number;
}

export interface ColumnMap {
  time?: number;
  speaker?: number;
  content: number;
  fromMe?: number;
  /** The cell value that means the row was sent by the user. */
  fromMeTrue?: string;
}

export interface ParseOptions {
  timeZone?: string | null;
  columnMap?: ColumnMap;
  chatId?: string;
}

export interface ParseWarning {
  code: string;
  lineNo?: number;
  detail?: string;
}

export interface ParseResult {
  records: ParsedRecord[];
  speakers: Array<{ name: string; count: number; firstAt?: Date; lastAt?: Date }>;
  chats?: Array<{ id: string; title: string; count: number }>;
  warnings: ParseWarning[];
  skipped: number;
}

export interface Importer {
  id: ImportFormatId;
  label: { zh: string; en: string };
  source: ImportSourceName;
  detect(source: ImportSource): DetectResult | null;
  parse(source: ImportSource, options: ParseOptions): Promise<ParseResult>;
}

/** What `persona_files.parseReport` holds while an import is running. */
export interface ParseReport {
  format?: ImportFormatId;
  confidence?: number;
  speakers?: ParseResult["speakers"];
  timeRange?: { firstAt?: string; lastAt?: string };
  roleCounts?: Record<string, number>;
  kindCounts?: Record<string, number>;
  skipped?: number;
  warnings?: ParseWarning[];
  written?: number;
  progress?: number;
  failedReason?: string;
  chats?: ParseResult["chats"];
}

export type { ParsedRecord, RecordKind };
