import { describe, expect, it } from "vitest";
import {
  BACKUP_EXCLUDED_TABLES,
  backupExclusions,
  backupTables,
  quoteIdentifier,
  schemaTables,
} from "./backup-tables";

describe("the tables a backup covers", () => {
  it("puts every schema table in the backup or in the exclusion list", () => {
    const declared = new Set(schemaTables().map((table) => table.name));
    const covered = new Set([
      ...backupTables().map((table) => table.name),
      ...BACKUP_EXCLUDED_TABLES.map((table) => table.table),
    ]);
    expect([...declared].filter((name) => !covered.has(name))).toEqual([]);
    // And nothing that no longer exists lingers in the lists.
    expect([...covered].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("writes users first and leaves out only the installation journal", () => {
    const names = backupTables().map((table) => table.name);
    expect(names[0]).toBe("users");
    expect(names).not.toContain("schema_migrations");
    expect(BACKUP_EXCLUDED_TABLES.map((row) => row.table)).toEqual(["schema_migrations"]);
    expect(BACKUP_EXCLUDED_TABLES[0].reason.length).toBeGreaterThan(10);
  });

  it("covers the same 56 data tables for a one-user backup", () => {
    const exclusions = backupExclusions(1).map((row) => row.table);
    expect(exclusions).toEqual(["schema_migrations"]);
  });

  it("quotes identifiers so a name cannot leave its table", () => {
    expect(quoteIdentifier("users")).toBe('"users"');
    expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
  });
});
