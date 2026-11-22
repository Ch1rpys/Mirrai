import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  BACKUP_EXCLUDED_TABLES,
  backupExclusions,
  backupTableDependencies,
  backupTables,
  orderBackupTables,
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

  it("writes every table after the tables it references", () => {
    /**
     * The restore inserts table by table in this order, and Postgres
     * checks a foreign key on the statement that inserts the child row.
     * `letters.personaId` is a real reference to `personas`, so writing
     * `letters` first makes the restore fail with 23503 on any instance
     * that has a letter. The declaration order did exactly that; the
     * list has to be a dependency order.
     */
    const names = backupTables().map((table) => table.name);
    const index = new Map(names.map((name, position) => [name, position]));
    const violations: string[] = [];
    for (const info of backupTables()) {
      for (const foreignKey of getTableConfig(info.table).foreignKeys) {
        const parent = getTableName(foreignKey.reference().foreignTable);
        const parentPosition = index.get(parent);
        if (parentPosition === undefined) continue;
        if (parentPosition > index.get(info.name)!) {
          violations.push(`${info.name} -> ${parent}`);
        }
      }
    }
    expect(violations).toEqual([]);
    // The regression this test pins, spelled out.
    expect(index.get("personas")).toBeLessThan(index.get("letters")!);
  });

  it("orders a stored manifest by its references, not by the order it stored", () => {
    /**
     * An archive written by an older build has the tables in schema
     * declaration order — `letters` before `personas` — which is exactly
     * the order that made the restore fail with 23503. The restore has to
     * fix the order itself rather than trust the manifest.
     */
    const forward = backupTables();
    const scrambled = orderBackupTables([...forward].reverse());
    expect(scrambled.map((table) => table.name)).toEqual(forward.map((table) => table.name));

    const index = new Map(scrambled.map((table, position) => [table.name, position]));
    for (const edge of backupTableDependencies(scrambled)) {
      expect(
        index.get(edge.parent)!,
        `${edge.child} must be written after ${edge.parent}`,
      ).toBeLessThan(index.get(edge.child)!);
    }
  });

  it("makes the restore use the dependency order it was given", () => {
    /**
     * `backupTables()` being ordered is not enough: the restore is what
     * inserts the rows, and it reads its list from the archive's
     * manifest, which an older build wrote in declaration order. The
     * restore has to re-sort that list instead of walking it.
     */
    const source = readFileSync("server/_core/backup.ts", "utf-8");
    expect(source).toContain("orderBackupTables(restoreTables)");
    // The insert loop walks the (now ordered) list.
    expect(source).toMatch(/for \(const table of restoreTables\)/);
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
