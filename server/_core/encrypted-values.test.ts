import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EncryptionKeyMissingError,
  decryptJsonForRead,
  decryptRecordMetaForRead,
  decryptRowForRead,
  decryptRowsForRead,
  decryptTextForRead,
  encryptJsonForWrite,
  encryptRecordMetaForWrite,
  encryptTextForWrite,
  encryptValueFor,
  encryptWriteValues,
  encryptionEnabledFor,
  forgetAllEncryptionStates,
  forgetEncryptionState,
  indexTokensFor,
  queryTokensFor,
  rememberEncryptionState,
  setEncryptionEnabled,
  usesBlindIndex,
} from "./encrypted-values";
import { decryptContent, encryptContent, generateDataKey, isEncryptedContent } from "./content-crypto";
import { forgetAllDataKeys, forgetDataKey, rememberDataKey } from "./data-keys";

/**
 * The transparent-encryption toolkit (C8.5).
 *
 * The database layer leans on three promises this file has to keep:
 * plaintext passes through untouched (mixed state during a migration),
 * ciphertext needs the key (a locked account is not shown base64), and
 * an encrypted write without the key fails instead of storing plaintext.
 */

let key: Buffer;

beforeEach(() => {
  forgetAllEncryptionStates();
  forgetAllDataKeys();
  key = generateDataKey();
});

afterEach(() => {
  forgetAllEncryptionStates();
  forgetAllDataKeys();
});

describe("the account's state", () => {
  it("treats an account with no recorded state as plaintext", () => {
    expect(encryptionEnabledFor(42)).toBe(false);
    expect(usesBlindIndex(42)).toBe(false);
  });

  it("learns the state from a user row's encryption value", () => {
    rememberEncryptionState(7, {
      enabled: true,
      wrappedKey: "v1:x:y:z",
      salt: "salt",
      kdf: "scrypt",
    });
    expect(encryptionEnabledFor(7)).toBe(true);
    rememberEncryptionState(8, null);
    expect(encryptionEnabledFor(8)).toBe(false);
  });

  it("treats a remembered data key as proof the account is encrypted", () => {
    rememberDataKey(9, key);
    expect(encryptionEnabledFor(9)).toBe(true);
    forgetEncryptionState(9);
    expect(encryptionEnabledFor(9)).toBe(true);
    forgetDataKey(9);
    expect(encryptionEnabledFor(9)).toBe(false);
  });
});

describe("text values", () => {
  it("leaves a plaintext account's values alone", () => {
    setEncryptionEnabled(1, false);
    expect(encryptTextForWrite(1, "在的呀")).toBe("在的呀");
    expect(decryptTextForRead(1, "在的呀")).toBe("在的呀");
  });

  it("encrypts a write for an unlocked encrypted account, and reads it back", () => {
    setEncryptionEnabled(2, true);
    rememberDataKey(2, key);
    const stored = encryptTextForWrite(2, "在的呀");
    expect(isEncryptedContent(stored)).toBe(true);
    expect(stored).not.toContain("在的呀");
    expect(decryptTextForRead(2, stored)).toBe("在的呀");
  });

  it("uses a fresh nonce, so the same line stores differently", () => {
    setEncryptionEnabled(2, true);
    rememberDataKey(2, key);
    const first = encryptTextForWrite(2, "晚安");
    const second = encryptTextForWrite(2, "晚安");
    expect(first).not.toBe(second);
    expect(decryptTextForRead(2, first!)).toBe("晚安");
    expect(decryptTextForRead(2, second!)).toBe("晚安");
  });

  it("passes a plaintext row through while the migration is half done", () => {
    setEncryptionEnabled(3, true);
    rememberDataKey(3, key);
    expect(decryptTextForRead(3, "还没有加密的一行")).toBe("还没有加密的一行");
  });

  it("keeps null as null", () => {
    setEncryptionEnabled(4, true);
    rememberDataKey(4, key);
    expect(encryptTextForWrite(4, null)).toBeNull();
    expect(decryptTextForRead(4, null)).toBeNull();
  });

  it("refuses to write plaintext when the key is gone", () => {
    setEncryptionEnabled(5, true);
    expect(() => encryptTextForWrite(5, "不能明文写入")).toThrow(EncryptionKeyMissingError);
  });

  it("refuses to hand back ciphertext when the key is gone", () => {
    const ciphertext = encryptContent(key, "只有登录后能读");
    setEncryptionEnabled(5, true);
    expect(() => decryptTextForRead(5, ciphertext)).toThrow(EncryptionKeyMissingError);
  });

  it("treats a value that only looks like a prefix as plaintext for a plaintext account", () => {
    setEncryptionEnabled(6, false);
    const text = "enc:v1:not-really";
    expect(decryptTextForRead(6, text)).toBe(text);
  });

  it("throws for ciphertext before the process has learned whether the account is encrypted", () => {
    const ciphertext = encryptContent(key, "在的呀");
    expect(() => decryptTextForRead(7, ciphertext)).toThrow(EncryptionKeyMissingError);
  });
});

describe("JSON values", () => {
  it("round-trips an object as { enc: ciphertext }", () => {
    setEncryptionEnabled(10, true);
    rememberDataKey(10, key);
    const stored = encryptJsonForWrite(10, { warmth: 3, rules: ["嗯"] });
    expect(stored).toHaveProperty("enc");
    expect(JSON.stringify(stored)).not.toContain("warmth");
    expect(decryptJsonForRead(10, stored)).toEqual({ warmth: 3, rules: ["嗯"] });
  });

  it("leaves a plaintext JSON row alone", () => {
    setEncryptionEnabled(10, true);
    rememberDataKey(10, key);
    expect(decryptJsonForRead(10, { legacy: true })).toEqual({ legacy: true });
  });

  it("refuses ciphertext without the key", () => {
    const stored = { enc: encryptContent(key, JSON.stringify({ a: 1 })) };
    setEncryptionEnabled(11, true);
    expect(() => decryptJsonForRead(11, stored)).toThrow(EncryptionKeyMissingError);
  });
});

describe("a record's meta", () => {
  it("keeps register readable in SQL and everything else inside the ciphertext", () => {
    setEncryptionEnabled(20, true);
    rememberDataKey(20, key);
    const meta = { register: "public", path: "a.jpg", caption: "海边的日落" };
    const stored = encryptRecordMetaForWrite(20, meta) as Record<string, unknown>;
    expect(stored.register).toBe("public");
    expect(typeof stored.enc).toBe("string");
    expect(JSON.stringify(stored)).not.toContain("海边的日落");
    expect(decryptRecordMetaForRead(20, stored)).toEqual(meta);
  });

  it("leaves a legacy plaintext meta alone", () => {
    setEncryptionEnabled(20, true);
    rememberDataKey(20, key);
    expect(decryptRecordMetaForRead(20, { register: "group", n: 1 })).toEqual({
      register: "group",
      n: 1,
    });
  });
});

describe("rows", () => {
  it("decrypts every listed column of a row, using the row owner", () => {
    setEncryptionEnabled(30, true);
    rememberDataKey(30, key);
    const row = {
      id: 1,
      userId: 30,
      content: encryptContent(key, "在的呀"),
      meta: encryptRecordMetaForWrite(30, { register: "private", transcript: "刚下课" }),
    };
    const [decrypted] = decryptRowsForRead("collected_messages", [row]);
    expect(decrypted!.content).toBe("在的呀");
    expect(decrypted!.meta).toEqual({ register: "private", transcript: "刚下课" });
  });

  it("leaves a projection without a userId untouched", () => {
    const plaintext = encryptContent(key, "在的呀");
    const rows = [{ id: 2, content: plaintext }];
    expect(decryptRowsForRead("messages", rows as never)).toEqual(rows);
  });

  it("decrypts one row and passes null through", () => {
    setEncryptionEnabled(31, true);
    rememberDataKey(31, key);
    const row = { userId: 31, body: encryptContent(key, "一封信") };
    expect(decryptRowForRead("letters", row)!.body).toBe("一封信");
    expect(decryptRowForRead("letters", null)).toBeNull();
  });
});

describe("writes", () => {
  it("encrypts only the columns a partial update mentions", () => {
    setEncryptionEnabled(40, true);
    rememberDataKey(40, key);
    const values = encryptWriteValues("letters", 40, { replyText: "答", status: "answered" });
    expect(isEncryptedContent(values.replyText)).toBe(true);
    expect(values.status).toBe("answered");
    expect(values).not.toHaveProperty("body");
  });

  it("encrypts a single value for the migration job", () => {
    setEncryptionEnabled(41, true);
    rememberDataKey(41, key);
    const wrapped = encryptValueFor(41, "json", { a: 1 }) as Record<string, unknown>;
    expect(typeof wrapped.enc).toBe("string");
  });
});

describe("the blind index", () => {
  it("uses plain bigrams for a plaintext account", () => {
    setEncryptionEnabled(50, false);
    expect(indexTokensFor(50, "喜欢海")).toContain("喜欢");
    expect(queryTokensFor(50, ["喜欢", "欢海"])).toEqual(["喜欢", "欢海"]);
  });

  it("uses a deterministic HMAC for an encrypted account", () => {
    setEncryptionEnabled(51, true);
    rememberDataKey(51, key);
    const first = indexTokensFor(51, "喜欢海");
    const second = indexTokensFor(51, "喜欢海");
    expect(first).toEqual(second);
    // Sixteen hex characters, and not the plain bigrams.
    for (const token of first) expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(first).not.toContain("喜欢");
    // The query is transformed the same way, so equality still matches.
    expect(queryTokensFor(51, ["喜欢", "欢海"])).toEqual(first);
  });

  it("gives a different index under a different key", () => {
    setEncryptionEnabled(52, true);
    rememberDataKey(52, key);
    const a = indexTokensFor(52, "喜欢海");
    forgetDataKey(52);
    rememberDataKey(52, generateDataKey());
    const b = indexTokensFor(52, "喜欢海");
    expect(a).not.toEqual(b);
  });
});

describe("the ciphertext of a changed byte", () => {
  it("does not read as a value", () => {
    const ciphertext = encryptContent(key, "晚安");
    const tampered = ciphertext.slice(0, -2) + (ciphertext.endsWith("AA") ? "BB" : "AA");
    setEncryptionEnabled(60, true);
    rememberDataKey(60, key);
    expect(() => decryptContent(key, tampered)).toThrow();
  });
});
