import type { ParsedRecord, RecordKind } from "@shared/records";

export type ImportFormatId = "generic-line";

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
}

export interface ParseOptions {
  timeZone?: string | null;
}

export type { ParsedRecord, RecordKind };
