/**
 * The app lock's settings (C8.4).
 *
 * The lock is one PIN per user, plus optional passkeys, and an idle
 * window after which the app asks for the PIN again. A persona can be
 * locked on its own too — the same PIN, but it has to have been entered
 * in the last five minutes.
 *
 * Everything that is a number with a rule lives here, so the server
 * (which enforces it), the client (which shows it) and the tests (which
 * try to get around it) all read the same values. The settings
 * themselves are stored in `users.lockSettings` as JSON; a row written
 * before this item has it empty, which means "the lock is off".
 */

/** A passkey, as the server keeps it after registration. */
export interface PasskeyRecord {
  /** The credential id, base64url — also the key the browser returns it under. */
  id: string;
  /** The raw public key bytes, base64url. */
  publicKey: string;
  /** The authenticator's signature counter, so a cloned authenticator can be noticed. */
  counter: number;
  /** How the browser can reach the authenticator ("internal", "hybrid", …). */
  transports?: string[];
  /** When it was registered, ISO — shown in the settings list. */
  createdAt?: string;
  /** What the user called it, if anything. */
  label?: string;
}

export interface LockSettings {
  /** Whether leaving the app idle locks it. */
  enabled: boolean;
  /** How long the app may sit idle before it locks, in minutes. */
  idleMinutes: number;
  /** The registered passkeys. Empty is normal. */
  passkeys: PasskeyRecord[];
}

/** The default idle window: five minutes is "away from the desk". */
export const LOCK_IDLE_MINUTES_DEFAULT = 5;
export const LOCK_IDLE_MINUTES_MIN = 1;
export const LOCK_IDLE_MINUTES_MAX = 60;

/** A PIN is 4–8 digits. Nothing else — no letters, no spaces. */
export const LOCK_PIN_MIN_LENGTH = 4;
export const LOCK_PIN_MAX_LENGTH = 8;

/** Five wrong PINs in five minutes and only the account password is accepted. */
export const LOCK_PIN_MAX_ATTEMPTS = 5;
export const LOCK_PIN_ATTEMPT_WINDOW_MS = 5 * 60_000;

/**
 * A locked persona needs the PIN this recently.
 *
 * It is not the app's idle window: the app may have been unlocked for
 * half an hour, and a locked persona still asks within five minutes
 * because that is the promise made when the switch was turned on.
 */
export const LOCK_RECENT_UNLOCK_MS = 5 * 60_000;

/** The most passkeys one account may keep. */
export const LOCK_MAX_PASSKEYS = 10;

/** Whether a string is a PIN the server accepts. */
export function isValidLockPin(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9]+$/.test(value) &&
    value.length >= LOCK_PIN_MIN_LENGTH &&
    value.length <= LOCK_PIN_MAX_LENGTH
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizePasskey(value: unknown): PasskeyRecord | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const publicKey = typeof value.publicKey === "string" ? value.publicKey.trim() : "";
  if (!id || !publicKey) return null;
  const counter = Number.isFinite(Number(value.counter)) ? Math.max(0, Math.floor(Number(value.counter))) : 0;
  const transports = Array.isArray(value.transports)
    ? value.transports.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
    : undefined;
  const record: PasskeyRecord = { id, publicKey, counter };
  if (transports && transports.length > 0) record.transports = transports;
  if (typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt))) {
    record.createdAt = value.createdAt;
  }
  if (typeof value.label === "string" && value.label.trim()) {
    record.label = value.label.trim().slice(0, 60);
  }
  return record;
}

/**
 * The settings, with every rule applied.
 *
 * An absent value is "the lock is off, five minutes, no passkeys". A
 * value the browser or the database hands back that is outside the
 * rules is clamped, not refused: a settings read must never fail, and
 * the only way to get an out-of-range number in is through an old row
 * or a hand edit.
 */
export function normalizeLockSettings(value: unknown): LockSettings {
  const source = isPlainObject(value) ? value : {};
  const seen = new Set<string>();
  const passkeys: PasskeyRecord[] = [];
  if (Array.isArray(source.passkeys)) {
    for (const entry of source.passkeys) {
      const passkey = normalizePasskey(entry);
      if (!passkey || seen.has(passkey.id)) continue;
      seen.add(passkey.id);
      passkeys.push(passkey);
      if (passkeys.length >= LOCK_MAX_PASSKEYS) break;
    }
  }
  return {
    enabled: source.enabled === true,
    idleMinutes: clampInteger(
      source.idleMinutes,
      LOCK_IDLE_MINUTES_DEFAULT,
      LOCK_IDLE_MINUTES_MIN,
      LOCK_IDLE_MINUTES_MAX,
    ),
    passkeys,
  };
}
