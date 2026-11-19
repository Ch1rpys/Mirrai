/**
 * Browser push.
 *
 * The payload is encrypted by `web-push` and posted to the endpoint the
 * browser handed us. That endpoint belongs to the browser vendor
 * (RFC 8030). A 404 or 410 means the subscription is gone
 * (https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
 * Library: https://github.com/web-push-libs/web-push#usage
 *
 * Failure here must not stop the message itself from being stored.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateVAPIDKeys, sendNotification, setVapidDetails } from "web-push";
import { resolveDataRoot } from "../bootstrap/bootstrap";
import * as db from "../db";

const DEFAULT_SUBJECT = "mailto:mirrai@localhost";
const PREVIEW_CHARS = 40;

export type PushKind = "reply" | "proactive" | "letter" | "reminder" | "capsule" | "followup";

export interface PushEvent {
  kind: PushKind;
  personaId: number;
  personaName: string;
  text?: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The first 40 characters, counting code points rather than UTF-16 units. */
export function previewText(text: string): string {
  return Array.from(text).slice(0, PREVIEW_CHARS).join("");
}

/**
 * What the push service receives, before encryption.
 *
 * The default carries no name and no message text. A subscription that
 * asked for a preview gets the name and the first 40 characters.
 */
export function buildPushPayload(event: PushEvent, showPreview: boolean): string {
  const payload: Record<string, string | number> = {
    kind: event.kind,
    personaId: event.personaId,
    url: `/chat/${event.personaId}`,
  };
  if (showPreview) {
    payload.title = event.personaName;
    if (event.text) payload.body = previewText(event.text);
  }
  return JSON.stringify(payload);
}

function vapidSubject(): string {
  const subject = process.env.VAPID_SUBJECT?.trim();
  return subject || DEFAULT_SUBJECT;
}

function readKeyFile(file: string): { publicKey: string; privateKey: string } | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      publicKey?: unknown;
      privateKey?: unknown;
    };
    if (typeof parsed.publicKey === "string" && typeof parsed.privateKey === "string"
      && parsed.publicKey && parsed.privateKey) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * VAPID keys for this install.
 *
 * Environment first, then `<data root>/vapid.json`, then a generated
 * pair written there with mode 0600.
 */
export function getVapidKeys(): VapidKeys {
  const subject = vapidSubject();
  const fromEnvPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const fromEnvPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (fromEnvPublic && fromEnvPrivate) {
    return { publicKey: fromEnvPublic, privateKey: fromEnvPrivate, subject };
  }
  const file = path.join(resolveDataRoot(), "vapid.json");
  const stored = readKeyFile(file);
  if (stored) return { ...stored, subject };
  const generated = generateVAPIDKeys();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ publicKey: generated.publicKey, privateKey: generated.privateKey }),
    { mode: 0o600 },
  );
  try {
    chmodSync(file, 0o600);
  } catch {
    // A platform that cannot chmod still has the file. The keys stay
    // on this machine either way.
  }
  return { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
}

function statusCodeOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { statusCode?: unknown }).statusCode;
  return typeof code === "number" ? code : null;
}

/**
 * Sends `event` to every subscription this user has.
 *
 * Never throws. A push that fails does not undo the message.
 */
export async function pushToUser(userId: number, event: PushEvent): Promise<number> {
  try {
    const subs = await db.listPushSubscriptions(userId);
    if (subs.length === 0) return 0;
    const keys = getVapidKeys();
    setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    for (const sub of subs) {
      const payload = buildPushPayload(event, sub.showPreview);
      try {
        await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        await db.markPushSuccess(userId, sub.endpoint);
      } catch (error) {
        const status = statusCodeOf(error);
        if (status === 404 || status === 410) {
          await db.deletePushSubscription(userId, sub.endpoint);
        } else {
          await db.markPushFailure(userId, sub.endpoint);
        }
      }
    }
    return subs.length;
  } catch (error) {
    console.warn("[Push] Could not send:", (error as Error).message);
    return 0;
  }
}
