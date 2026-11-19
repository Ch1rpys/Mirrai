/**
 * The parts of `web-push` this app calls.
 *
 * Version 4 is ESM and ships no declarations. The names match
 * `node_modules/web-push/src/index.js`.
 * https://github.com/web-push-libs/web-push#usage
 */
declare module "web-push" {
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload?: string | Buffer | null,
    options?: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
  export class WebPushError extends Error {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    endpoint: string;
  }
}
