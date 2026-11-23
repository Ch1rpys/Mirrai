/**
 * The channel registry.
 *
 * Adding a channel means adding an adapter here; everything else — the
 * conversation pipeline, the commands, the safety layer — is shared.
 */
import { feishuAdapter } from "./feishu";
import { wechatAdapter } from "./wechat";
import { telegramAdapter } from "./telegram";
import { discordAdapter } from "./discord";
import { matrixAdapter } from "./matrix";
import { channelLabel } from "./types";
import type { ChannelAdapter, ChannelId, ChannelStatus, PluginChannelId } from "./types";

export type { ChannelAdapter, ChannelId, ChannelStatus, PluginChannelId };
export { channelLabel };

const adapters = new Map<ChannelId | PluginChannelId, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  adapters.set(adapter.id, adapter);
}

registerChannel(wechatAdapter);
registerChannel(feishuAdapter);
// The bot channels (C9.1). They only run once the user has stored their
// credentials; with none, `start` refuses with a sentence.
registerChannel(telegramAdapter);
registerChannel(discordAdapter);
registerChannel(matrixAdapter);

export function getChannelAdapter(id: ChannelId | string): ChannelAdapter | undefined {
  return adapters.get(id as ChannelId | PluginChannelId);
}

export function listChannels(): ChannelAdapter[] {
  return Array.from(adapters.values());
}

/**
 * Restores the channels that were connected before the last restart.
 *
 * A channel that cannot be restored (expired credentials, a channel that was
 * never configured) is skipped rather than failing the boot.
 */
/**
 * Stops every channel that is running.
 *
 * The WeChat poll loop and the Feishu long connection keep running
 * until they are told to stop — so without this the process was left
 * with them open when it was asked to shut down.
 */
export async function stopAllChannels(): Promise<void> {
  for (const adapter of listChannels()) {
    if (typeof adapter.stopAll !== "function") continue;
    try {
      await adapter.stopAll();
    } catch {
      // A channel that will not stop must not hold the shutdown up.
    }
  }
}

/**
 * Stops every channel that is running for one user.
 *
 * It is what "delete my account" needs: the account is gone, so
 * nothing may keep talking on its behalf — not on WeChat, not on
 * Feishu.
 *
 * The WeChat poll loop and the Feishu long connection keep running
 * until they are told to stop, and deleting the rows does not stop
 * them: the bot went on answering on WeChat for an account that no
 * longer existed, and the messages it wrote carried a user id that no
 * longer had a user.
 */
export async function stopChannelsForUser(userId: number): Promise<void> {
  for (const adapter of listChannels()) {
    try {
      await adapter.stop(userId);
    } catch (e) {
      // A channel that will not stop must not hold the deletion up.
      console.warn(`[Channels] Could not stop the ${adapter.id} channel for user ${userId}:`, e);
    }
  }
}

export async function restoreChannels(userIds: number[]): Promise<void> {
  for (const userId of userIds) {
    for (const adapter of listChannels()) {
      if (typeof adapter.restore !== "function") continue;
      try {
        const restored = await adapter.restore(userId);
        if (restored) {
          console.log(`[Channels] Restored the ${adapter.id} channel for user ${userId}`);
        }
      } catch (e) {
        console.warn(`[Channels] Could not restore the ${adapter.id} channel for user ${userId}:`, e);
      }
    }
  }
}
