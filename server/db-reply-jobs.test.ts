import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { InsertReplyJob } from "../drizzle/schema";

/**
 * The unique-index fallback of `createReplyJob`.
 *
 * `reply_jobs` has one partial unique index: one pending/running reply
 * per user and persona (B5.2). Two turns that both decide to defer can
 * both read "no pending job" and both insert; the database refuses the
 * second one, and `createReplyJob` is supposed to answer with the row
 * that won instead of throwing.
 *
 * The real driver does not put the SQLSTATE where the helper used to
 * look. Drizzle wraps a failed query in `DrizzleQueryError`, and the pg
 * error — with `code: "23505"` — lives at `error.cause`. The existing
 * tests mock `../db` and fold the duplicate inside the mock, so they
 * never see either the wrapper or the fallback. This file keeps the
 * real `createReplyJob` and gives it a fake database that rejects the
 * way the real one does.
 */

/** What a select should answer. */
let existingRows: any[] = [];
/** What an insert should throw, if anything. */
let insertError: unknown = null;
/** The queries the fake ran, in order. */
let queries: Array<{ operation: "insert" | "select"; table: string; values?: any; returned: boolean }> = [];

class FakeQuery {
  private readonly entry: (typeof queries)[number];

  constructor(operation: "insert" | "select", table = "") {
    this.entry = { operation, table, returned: false };
    queries.push(this.entry);
  }

  from(table: any) {
    this.entry.table = getTableName(table);
    return this;
  }

  values(values: any) {
    this.entry.values = values;
    return this;
  }

  returning() {
    this.entry.returned = true;
    return this;
  }

  where(..._conditions: any[]) {
    return this;
  }

  orderBy(..._expressions: any[]) {
    return this;
  }

  limit(_count: number) {
    return this;
  }

  then(resolve: (value: any) => any, reject: (reason: any) => any) {
    if (this.entry.operation === "insert" && insertError) {
      return Promise.reject(insertError).then(resolve, reject);
    }
    const rows = this.entry.operation === "select" ? existingRows : [];
    return Promise.resolve(rows).then(resolve, reject);
  }
}

const fakeDb = {
  insert: (table: any) => new FakeQuery("insert", getTableName(table)),
  select: () => new FakeQuery("select"),
};

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => fakeDb,
}));

// `getDb` refuses to hand out a connection without one. Nothing connects:
// the drizzle module above is the fake.
process.env.DATABASE_URL = "postgres://fake/fake";

import { createReplyJob } from "./db";

const EXISTING = {
  id: 41,
  userId: 7,
  personaId: 3,
  kind: "reply",
  status: "pending",
  reason: "delay",
  dueAt: new Date("2026-01-02T03:04:05.000Z"),
  channel: "web",
  targetId: null,
  locale: "zh",
  periodId: null,
  attempts: 0,
  claimedAt: null,
  payload: {},
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  finishedAt: null,
};

const INSERT: InsertReplyJob = {
  userId: 7,
  personaId: 3,
  kind: "reply",
  status: "pending",
  reason: "delay",
  dueAt: EXISTING.dueAt,
  channel: "web",
  targetId: null,
  locale: "zh",
  periodId: null,
  attempts: 0,
  payload: {},
};

function duplicateKey(): Error {
  // pg sets `code` on the error it raises; the message is what a log sees.
  return Object.assign(new Error('duplicate key value violates unique constraint "reply_jobs_one_pending_reply_idx"'), {
    code: "23505",
    detail: "Key (\"userId\", \"personaId\")=(7, 3) already exists.",
  });
}

/**
 * The error drizzle's session throws for a failed statement: the pg error
 * is not re-thrown, it is kept as the cause.
 */
function wrapped(cause: Error): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "reply_jobs" ("userId", "personaId", "kind", "status", "reason", "dueAt", "channel", "locale", "attempts", "payload") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *',
    [7, 3, "reply", "pending", "delay", EXISTING.dueAt, "web", "zh", 0, "{}"],
    cause,
  );
}

beforeEach(() => {
  existingRows = [];
  insertError = null;
  queries = [];
});

describe("createReplyJob and the one-pending-reply index", () => {
  it("returns the existing pending job when the insert hits the unique index", async () => {
    existingRows = [EXISTING];
    insertError = wrapped(duplicateKey());

    const job = await createReplyJob(INSERT);

    // The whole point: the caller gets the row that won the race, not
    // DrizzleQueryError.
    expect(job).toBe(EXISTING);
    // And it really asked for the pending row, rather than inventing one.
    const select = queries.find((query) => query.operation === "select");
    expect(select?.table).toBe("reply_jobs");
    expect(queries.map((query) => query.operation)).toEqual(["insert", "select"]);
  });

  it("finds the code through a cause chain that is not the driver's exact shape", async () => {
    // The wrapped error's own `cause` can be wrapped again (an adapter or
    // a retry layer), so the walk is by depth, not one fixed hop.
    existingRows = [EXISTING];
    insertError = wrapped(Object.assign(new Error("outer"), { cause: duplicateKey() }));

    await expect(createReplyJob(INSERT)).resolves.toBe(EXISTING);
  });

  it("still recognizes a plain pg-shaped error with no wrapper", async () => {
    existingRows = [EXISTING];
    insertError = duplicateKey();

    await expect(createReplyJob(INSERT)).resolves.toBe(EXISTING);
  });

  it("rethrows an error that is not a unique violation", async () => {
    const foreignKey = Object.assign(
      new Error('insert or update on table "reply_jobs" violates foreign key constraint'),
      { code: "23503" },
    );
    insertError = wrapped(foreignKey);

    await expect(createReplyJob(INSERT)).rejects.toBe(insertError);
    expect(queries.map((query) => query.operation)).toEqual(["insert"]);
  });

  it("rethrows the original error when the conflicting row is already gone", async () => {
    existingRows = [];
    const error = wrapped(duplicateKey());
    insertError = error;

    await expect(createReplyJob(INSERT)).rejects.toBe(error);
    expect(queries.map((query) => query.operation)).toEqual(["insert", "select"]);
  });

  it("does not loop forever on a self-referential cause chain", async () => {
    const loop = new Error("wrapped without a code") as Error & { cause?: unknown };
    loop.cause = loop;
    insertError = loop;

    await expect(createReplyJob(INSERT)).rejects.toBe(loop);
  });
});
