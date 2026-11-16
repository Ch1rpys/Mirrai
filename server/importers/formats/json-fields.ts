/**
 * Field names the collectors already accepted on a WeChat-shaped JSON
 * record. Importers reuse the same keys so a file that used to go
 * through a collector still reads.
 */
import { parseExportTime } from "../normalize";

export function jsonString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      const parts = value
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const inner = (part as Record<string, unknown>).text;
            return typeof inner === "string" ? inner : "";
          }
          return "";
        })
        .filter((part) => part.length > 0);
      if (parts.length > 0) return parts.join("").trim();
    }
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      for (const innerKey of ["text", "content", "title", "name"]) {
        const inner = nested[innerKey];
        if (typeof inner === "string" && inner.trim()) return inner.trim();
      }
    }
  }
  return "";
}

export function jsonTime(
  record: Record<string, unknown>,
  keys: string[],
  timeZone?: string | null,
): Date | null {
  for (const key of keys) {
    const value = record[key];
    if (value == null || value === "") continue;
    const parsed = parseExportTime(value as string | number, timeZone);
    if (parsed) return parsed;
  }
  return null;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseJsonDocument(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

export function messageList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const obj = asObject(data);
  if (!obj) return [];
  for (const key of ["messages", "msg", "data", "list", "items"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}
