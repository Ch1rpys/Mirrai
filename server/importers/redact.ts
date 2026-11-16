/**
 * Import-time redaction. The matching lives in `shared/redact.ts` so
 * the wizard preview and the writer use the same function.
 */
export {
  redactRecords,
  redactionReportOf,
  isRedactionActive,
  isKeptName,
  emptyRedactionCounts,
} from "@shared/redact";
export type { RedactionOptions, RedactionCounts, RedactionReport } from "@shared/redact";
