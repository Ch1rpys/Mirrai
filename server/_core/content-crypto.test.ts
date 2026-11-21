import { describe, expect, it } from "vitest";
import {
  ContentDecryptionError,
  blindIndexToken,
  decryptContent,
  derivePasswordKey,
  encryptContent,
  generateDataKey,
  generateRecoveryCode,
  generateSalt,
  isEncryptedContent,
  normalizeRecoveryCode,
  tryDecryptContent,
  unwrapDataKeyWithPassword,
  unwrapDataKeyWithRecovery,
  unwrapWithKey,
  wrapDataKeyForPassword,
  wrapDataKeyForRecovery,
  wrapWithKey,
} from "./content-crypto";

/**
 * The cryptography behind encrypted storage (C8.5).
 *
 * Four promises: a value survives a round trip, two encryptions of the
 * same value differ, a changed byte fails to open, and a value without
 * the prefix is returned untouched (the interrupted-migration state).
 * The data key's wrapping is the same primitive with a different key.
 */

/** The expensive KDF is used once per test where the parameter can be picked. */
const FAST = { N: 1024, r: 8, p: 1, maxmem: 16 * 1024 * 1024 };

describe("content encryption", () => {
  const dataKey = generateDataKey();

  it("round-trips a value", () => {
    const cipher = encryptContent(dataKey, "在吗？今天下雨了。");
    expect(isEncryptedContent(cipher)).toBe(true);
    expect(cipher.startsWith("enc:v1:")).toBe(true);
    expect(cipher).not.toContain("今天下雨");
    expect(tryDecryptContent(dataKey, cipher)).toBe("在吗？今天下雨了。");
    expect(decryptContent(dataKey, cipher)).toBe("在吗？今天下雨了。");
  });

  it("gives a different ciphertext every time", () => {
    const first = encryptContent(dataKey, "同样的一句话");
    const second = encryptContent(dataKey, "同样的一句话");
    expect(first).not.toBe(second);
    // Both still read back.
    expect(tryDecryptContent(dataKey, first)).toBe("同样的一句话");
    expect(tryDecryptContent(dataKey, second)).toBe("同样的一句话");
  });

  it("fails when a byte of the ciphertext changes", () => {
    const cipher = encryptContent(dataKey, "不要改我");
    const marker = "enc:v1:";
    const body = cipher.slice(marker.length);
    const flipped = marker + (body[0] === "A" ? "B" : "A") + body.slice(1);
    expect(tryDecryptContent(dataKey, flipped)).toBeNull();
    expect(() => decryptContent(dataKey, flipped)).toThrow(ContentDecryptionError);
  });

  it("fails with the wrong key rather than returning garbage", () => {
    const cipher = encryptContent(dataKey, "只有我读得懂");
    expect(tryDecryptContent(generateDataKey(), cipher)).toBeNull();
  });

  it("returns a value without the prefix as it is", () => {
    expect(isEncryptedContent("一段旧明文")).toBe(false);
    expect(tryDecryptContent(dataKey, "一段旧明文")).toBe("一段旧明文");
    expect(decryptContent(dataKey, "一段旧明文")).toBe("一段旧明文");
  });

  it("leaves empty strings alone", () => {
    expect(tryDecryptContent(dataKey, "")).toBe("");
  });
});

describe("wrapping the data key", () => {
  it("round-trips through the account password", async () => {
    const dataKey = generateDataKey();
    const wrapped = await wrapDataKeyForPassword(dataKey, "correct horse battery");
    expect(wrapped.kdf).toBe("scrypt");
    expect(wrapped.wrappedKey.startsWith("v1:")).toBe(true);
    // The key itself never appears in the wrapped form.
    expect(wrapped.wrappedKey).not.toContain(dataKey.toString("base64url"));
    const unwrapped = await unwrapDataKeyWithPassword(
      wrapped.wrappedKey,
      wrapped.salt,
      "correct horse battery",
    );
    expect(unwrapped?.equals(dataKey)).toBe(true);
  }, 30_000);

  it("does not unwrap with a different password or no password", async () => {
    const dataKey = generateDataKey();
    const wrapped = await wrapDataKeyForPassword(dataKey, "the real password");
    expect(
      await unwrapDataKeyWithPassword(wrapped.wrappedKey, wrapped.salt, "another password"),
    ).toBeNull();
    expect(await unwrapDataKeyWithPassword(wrapped.wrappedKey, wrapped.salt, "")).toBeNull();
  }, 30_000);

  it("fails when the wrapped bytes are changed", async () => {
    const dataKey = generateDataKey();
    const wrapped = await wrapDataKeyForPassword(dataKey, "a password");
    const tampered = wrapped.wrappedKey.slice(0, -2) + "AA";
    expect(
      await unwrapDataKeyWithPassword(tampered, wrapped.salt, "a password"),
    ).toBeNull();
  }, 30_000);

  it("round-trips with a fast derivation when a caller picks the parameters", async () => {
    const dataKey = generateDataKey();
    const salt = generateSalt();
    const key = await derivePasswordKey("password", salt, FAST);
    const wrapped = wrapWithKey(key, dataKey);
    const unwrapped = unwrapWithKey(key, wrapped);
    expect(unwrapped?.equals(dataKey)).toBe(true);
  });
});

describe("the recovery code", () => {
  it("is printed in six groups of four readable characters", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){5}$/);
    expect(generateRecoveryCode()).not.toBe(code);
  });

  it("round-trips the data key however it is typed back", async () => {
    const dataKey = generateDataKey();
    const code = generateRecoveryCode();
    const wrapped = await wrapDataKeyForRecovery(dataKey, code, "recovery-salt");
    // Lower case, spaces instead of dashes: still the same code.
    const typed = ` ${code.toLowerCase().replace(/-/g, " ")} `;
    const unwrapped = await unwrapDataKeyWithRecovery(
      wrapped.recoveryWrappedKey,
      wrapped.salt,
      typed,
    );
    expect(unwrapped?.equals(dataKey)).toBe(true);
    expect(normalizeRecoveryCode(typed)).toBe(normalizeRecoveryCode(code));
  }, 30_000);

  it("does not open with another code", async () => {
    const dataKey = generateDataKey();
    const wrapped = await wrapDataKeyForRecovery(dataKey, generateRecoveryCode(), "salt");
    expect(
      await unwrapDataKeyWithRecovery(
        wrapped.recoveryWrappedKey,
        wrapped.salt,
        generateRecoveryCode(),
      ),
    ).toBeNull();
  }, 30_000);
});

describe("the blind index", () => {
  const dataKey = generateDataKey();

  it("is sixteen hex characters and deterministic", () => {
    const first = blindIndexToken(dataKey, "喜欢海");
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(blindIndexToken(dataKey, "喜欢海")).toBe(first);
    expect(blindIndexToken(dataKey, "讨厌海")).not.toBe(first);
  });

  it("is different for a different account's key", () => {
    expect(blindIndexToken(generateDataKey(), "喜欢海")).not.toBe(
      blindIndexToken(dataKey, "喜欢海"),
    );
  });
});
