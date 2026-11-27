/**
 * Sending a letter's reply to the user's own inbox (C5.5).
 *
 * The letter is still written in the app. This is one way to hear about
 * the answer: the user fills in their own SMTP server, turns the switch
 * on for a persona, and the reply goes out as plain text. Nothing is
 * collected: the app never checks the mailbox for a reply.
 *
 * The credentials live in `channel_states` under the `email` channel,
 * encrypted with `encryptSecret`, the same place and the same way the
 * WeChat token is kept.
 */
import { createTransport } from "nodemailer";
import { copy, type Locale } from "@shared/copy";
import { decryptSecret, encryptSecret } from "./crypto";
import { getChannelState, upsertChannelState } from "../db";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
  /** Whether the subject names the persona. Off by default. */
  subjectWithName: boolean;
}

export type EmailConfigWithoutPassword = Omit<EmailConfig, "pass">;

const CHANNEL = "email";

function isEmailConfig(value: unknown): value is EmailConfig {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.host === "string" && row.host.length > 0 &&
    typeof row.port === "number" && Number.isInteger(row.port) &&
    typeof row.secure === "boolean" &&
    typeof row.user === "string" &&
    typeof row.pass === "string" &&
    typeof row.from === "string" &&
    typeof row.to === "string" &&
    typeof row.subjectWithName === "boolean"
  );
}

/** The user's saved server, with the password. Null when there is none. */
export async function readEmailConfig(userId: number): Promise<EmailConfig | null> {
  const state = await getChannelState(userId, CHANNEL);
  if (!state?.credentialsEnc) return null;
  const plaintext = await decryptSecret(state.credentialsEnc);
  if (!plaintext) return null;
  try {
    const parsed = JSON.parse(plaintext) as unknown;
    return isEmailConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Saves the server, keeping the saved password when the form left it
 * blank.
 */
export async function saveEmailConfig(
  userId: number,
  input: Omit<EmailConfig, "pass"> & { pass?: string },
): Promise<boolean> {
  const existing = await readEmailConfig(userId);
  const pass = input.pass && input.pass.length > 0 ? input.pass : existing?.pass;
  if (!pass) return false;
  const config: EmailConfig = { ...input, pass };
  await upsertChannelState(userId, CHANNEL, {
    status: "configured",
    credentialsEnc: await encryptSecret(JSON.stringify(config)),
  });
  return true;
}

export async function clearEmailConfig(userId: number): Promise<void> {
  await upsertChannelState(userId, CHANNEL, {
    status: "stopped",
    credentialsEnc: null,
  });
}

/** The mail a reply turns into. Plain text only, on purpose. */
export function buildLetterEmail(params: {
  config: Pick<EmailConfig, "subjectWithName">;
  personaName: string;
  body: string;
  locale?: Locale;
}): { subject: string; text: string } {
  const locale = params.locale ?? "zh";
  /**
   * A header is one line (P18.4).
   *
   * A persona name is user input, and a name with CR/LF made the subject
   * multi-line. Nodemailer encodes the header, so this was never header
   * injection; a subject is still meant to be a single line.
   */
  const name = params.personaName.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    subject: params.config.subjectWithName
      ? copy(locale, "mail.subjectWithName", { name })
      : copy(locale, "mail.subject"),
    // The footer is fixed and always there: the reader has to know the
    // letter was rebuilt, whichever mailbox it landed in.
    text: `${params.body}\n\n${copy(locale, "mail.footer", { name: params.personaName })}`,
  };
}

function transportFor(config: EmailConfig) {
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
}

/**
 * Sends one message. Never throws: a failing mail server must not make
 * the letter look unanswered.
 */
async function send(config: EmailConfig, subject: string, text: string): Promise<boolean> {
  try {
    const transport = transportFor(config);
    await transport.sendMail({
      from: config.from,
      to: config.to,
      subject,
      text,
    });
    return true;
  } catch (error) {
    console.warn("[Mail] The message could not be sent:", (error as Error).message);
    return false;
  }
}

export async function sendTestEmail(userId: number, locale: Locale = "zh"): Promise<boolean> {
  const config = await readEmailConfig(userId);
  if (!config) return false;
  const subject = copy(locale, "mail.subject");
  const text = copy(locale, "mail.testBody");
  return send(config, subject, text);
}

/**
 * Emails a reply when the persona asked for it and a server is set up.
 *
 * A missing configuration is not an error — most users never fill one in.
 */
export async function deliverLetterEmail(params: {
  userId: number;
  personaName: string;
  body: string;
  letterEmail: boolean;
  locale?: Locale;
}): Promise<boolean> {
  if (!params.letterEmail) return false;
  let config: EmailConfig | null = null;
  try {
    config = await readEmailConfig(params.userId);
  } catch (error) {
    console.warn("[Mail] The settings could not be read:", (error as Error).message);
    return false;
  }
  if (!config) return false;
  const { subject, text } = buildLetterEmail({
    config,
    personaName: params.personaName,
    body: params.body,
    locale: params.locale,
  });
  return send(config, subject, text);
}
