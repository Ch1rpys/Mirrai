import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { ENV } from "../_core/env";
import { importUnpackRelKey } from "./archive";

const updatePersonaFile = vi.fn();
const getPersonaFileById = vi.fn();
const getUserTimezone = vi.fn();

vi.mock("../db", () => ({
  getPersonaFileById: (...a: unknown[]) => getPersonaFileById(...a),
  updatePersonaFile: (...a: unknown[]) => updatePersonaFile(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getPersonaById: vi.fn(),
  getUserById: vi.fn(),
  deleteRecordsByFile: vi.fn(),
}));

vi.mock("../_core/style-profile", () => ({
  afterRecordsChanged: vi.fn(),
}));

import { startImport } from "./index";

const FILE_ID = 11;
const USER_ID = 7;
const PERSONA_ID = 9;

function zipOf(files: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) data[name] = strToU8(body);
  return zipSync(data);
}

afterEach(async () => {
  await rm(path.join(ENV.uploadDir, importUnpackRelKey(USER_ID, PERSONA_ID, FILE_ID)), {
    recursive: true,
    force: true,
  });
});

describe("a zip of several chats", () => {
  it("lists each file with the number of messages in it", async () => {
    getPersonaFileById.mockResolvedValue({
      id: FILE_ID,
      personaId: PERSONA_ID,
      userId: USER_ID,
      fileType: "archive",
      originalName: "chats.zip",
    });
    updatePersonaFile.mockResolvedValue(true);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");

    const result = await startImport({
      fileId: FILE_ID,
      userId: USER_ID,
      bytes: zipOf({
        "a.txt": "[2022-03-01 20:00:00] 小满：在吗\n[2022-03-01 20:00:05] 阿树：在的",
        "b.txt": "[2022-03-01 21:00:00] 小满：早",
      }),
      locale: "zh",
    });

    expect(result).toMatchObject({ status: "needs_chat", written: 0 });
    const waiting = updatePersonaFile.mock.calls
      .map((call) => call[2] as { parseStatus?: string; parseReport?: { chats?: Array<{ id: string; count: number }> } })
      .find((patch) => patch.parseStatus === "needs_chat");
    const chats = [...(waiting?.parseReport?.chats ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    expect(chats).toEqual([
      { id: "a.txt", title: "a.txt", count: 2 },
      { id: "b.txt", title: "b.txt", count: 1 },
    ]);
  });
});
