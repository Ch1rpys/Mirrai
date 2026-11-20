import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getChannelState = vi.fn();
const upsertChannelState = vi.fn();
const sendMail = vi.fn();
const createTransport = vi.fn((..._args: unknown[]) => ({ sendMail }));

vi.mock("../db", () => ({
  getChannelState: (...args: unknown[]) => getChannelState(...args),
  upsertChannelState: (...args: unknown[]) => upsertChannelState(...args),
}));

vi.mock("nodemailer", () => ({
  createTransport: (...args: unknown[]) => createTransport(...args),
}));

import {
  buildLetterEmail,
  clearEmailConfig,
  deliverLetterEmail,
  readEmailConfig,
  saveEmailConfig,
  sendTestEmail,
} from "./mail";
import { decryptSecret } from "./crypto";

const CONFIG = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  user: "me@example.test",
  pass: "the-password",
  from: "mirrai@example.test",
  to: "me@example.test",
  subjectWithName: false,
};

describe("the letter email (C5.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChannelState.mockResolvedValue(null);
    sendMail.mockResolvedValue({ messageId: "one" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the default subject free of the persona's name", () => {
    const mail = buildLetterEmail({
      config: { subjectWithName: false },
      personaName: "小满",
      body: "回信正文",
    });
    expect(mail.subject).toBe("你有一封回信");
    expect(mail.subject).not.toContain("小满");
    expect(mail.text).toContain("回信正文");
    expect(mail.text).toContain("不是 小满 本人写的");
    expect(mail.text).not.toContain("<img");
    expect(mail.text).not.toContain("http");
  });

  it("puts the name in the subject only when asked", () => {
    const mail = buildLetterEmail({
      config: { subjectWithName: true },
      personaName: "小满",
      body: "回信正文",
    });
    expect(mail.subject).toBe("小满 的回信");
  });

  it("sends plain text, with the fixed footer and no tracking", async () => {
    getChannelState.mockResolvedValue({
      credentialsEnc: await import("./crypto").then((module) =>
        module.encryptSecret(JSON.stringify(CONFIG))),
    });
    const sent = await deliverLetterEmail({
      userId: 1,
      personaName: "小满",
      body: "回信正文",
      letterEmail: true,
    });
    expect(sent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.from).toBe(CONFIG.from);
    expect(message.to).toBe(CONFIG.to);
    expect(message.subject).toBe("你有一封回信");
    expect(message.text).toContain("回信正文");
    expect(message.text).toContain("不是 小满 本人写的");
    expect(message.html).toBeUndefined();
    expect(message.attachments).toBeUndefined();
  });

  it("does nothing when the switch is off", async () => {
    const sent = await deliverLetterEmail({
      userId: 1,
      personaName: "小满",
      body: "回信正文",
      letterEmail: false,
    });
    expect(sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does nothing when no server is set up", async () => {
    getChannelState.mockResolvedValue(null);
    const sent = await deliverLetterEmail({
      userId: 1,
      personaName: "小满",
      body: "回信正文",
      letterEmail: true,
    });
    expect(sent).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("resolves false when the mail server refuses, and does not throw", async () => {
    getChannelState.mockResolvedValue({
      credentialsEnc: await import("./crypto").then((module) =>
        module.encryptSecret(JSON.stringify(CONFIG))),
    });
    sendMail.mockRejectedValue(new Error("connection refused"));
    await expect(deliverLetterEmail({
      userId: 1,
      personaName: "小满",
      body: "回信正文",
      letterEmail: true,
    })).resolves.toBe(false);
  });

  it("stores the password encrypted, and never in the clear", async () => {
    upsertChannelState.mockResolvedValue(1);
    await saveEmailConfig(1, CONFIG);
    const stored = upsertChannelState.mock.calls[0][2].credentialsEnc;
    expect(String(stored).startsWith("v1:")).toBe(true);
    expect(String(stored)).not.toContain("the-password");
    const decrypted = await decryptSecret(stored);
    expect(JSON.parse(String(decrypted))).toMatchObject({ pass: "the-password" });
  });

  it("keeps the saved password when the form leaves it blank", async () => {
    getChannelState.mockResolvedValue({
      credentialsEnc: await import("./crypto").then((module) =>
        module.encryptSecret(JSON.stringify(CONFIG))),
    });
    upsertChannelState.mockResolvedValue(1);
    await saveEmailConfig(1, { ...CONFIG, pass: "" });
    const decrypted = await decryptSecret(upsertChannelState.mock.calls[0][2].credentialsEnc);
    expect(JSON.parse(String(decrypted)).pass).toBe("the-password");
  });

  it("returns null for a server that cannot be read", async () => {
    getChannelState.mockResolvedValue({ credentialsEnc: "v1:garbage" });
    expect(await readEmailConfig(1)).toBeNull();
    getChannelState.mockResolvedValue({ credentialsEnc: "not-encrypted" });
    expect(await readEmailConfig(1)).toBeNull();
  });

  it("sends a test message to the same address", async () => {
    getChannelState.mockResolvedValue({
      credentialsEnc: await import("./crypto").then((module) =>
        module.encryptSecret(JSON.stringify(CONFIG))),
    });
    await expect(sendTestEmail(1)).resolves.toBe(true);
    expect(sendMail.mock.calls[0][0].text).toContain("测试信");
  });

  it("clears the server", async () => {
    upsertChannelState.mockResolvedValue(1);
    await clearEmailConfig(1);
    expect(upsertChannelState).toHaveBeenCalledWith(1, "email", {
      status: "stopped",
      credentialsEnc: null,
    });
  });
});
