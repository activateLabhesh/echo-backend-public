import { mentionRepository } from '../repositories/mentionRepository';
import * as MentionTypes from '../types/mentions.type';

export class AppError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeLimit(limit: unknown): number {
  const parsedLimit = Number(limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return 20;
  }

  return Math.min(parsedLimit, 100);
}

function buildMentionNotificationResponse(
  notification: MentionTypes.MentionNotificationRecord,
  message?: MentionTypes.MentionMessageRecord | null,
  sender?: MentionTypes.MentionUserRecord | null,
  channel?: MentionTypes.MentionChannelRecord | null,
  server?: MentionTypes.MentionServerRecord | null,
) {
  return {
    id: notification.id,
    user_id: notification.user_id,
    message_id: notification.message_id,
    is_read: notification.is_read,
    created_at: notification.created_at,
    message: {
      id: message?.id,
      content: message?.content || '',
      sender_id: message?.sender_id,
      channel_id: message?.channel_id,
      users: {
        username: sender?.username || 'Unknown User',
        avatar_url: sender?.avatar_url || null,
      },
      channels: {
        name: channel?.name || 'unknown',
        server_id: channel?.server_id || null,
        servers: {
          name: server?.name || 'Unknown Server',
        },
      },
    },
  };
}

async function buildManualMentionNotifications(notifications: MentionTypes.MentionNotificationRecord[]) {
  const messageIds = notifications.map((notification) => notification.message_id);
  const messages = await mentionRepository.getMessagesByIds(messageIds);

  const messageMap = new Map<string, MentionTypes.MentionMessageRecord>();
  const senderIds = new Set<string>();
  const channelIds = new Set<string>();

  messages.forEach((message) => {
    messageMap.set(message.id, message);

    if (message.sender_id) {
      senderIds.add(message.sender_id);
    }

    if (message.channel_id) {
      channelIds.add(message.channel_id);
    }
  });

  const [users, channels] = await Promise.all([
    mentionRepository.getUsersByIds(Array.from(senderIds)),
    mentionRepository.getChannelsByIds(Array.from(channelIds)),
  ]);

  const userMap = new Map<string, MentionTypes.MentionUserRecord>();
  users.forEach((user) => {
    if (user.id) {
      userMap.set(user.id, user);
    }
  });

  const channelMap = new Map<string, MentionTypes.MentionChannelRecord>();
  const serverIds = new Set<string>();
  channels.forEach((channel) => {
    if (channel.id) {
      channelMap.set(channel.id, channel);
    }

    if (channel.server_id) {
      serverIds.add(channel.server_id);
    }
  });

  const servers = await mentionRepository.getServersByIds(Array.from(serverIds));
  const serverMap = new Map<string, MentionTypes.MentionServerRecord>();
  servers.forEach((server) => {
    if (server.id) {
      serverMap.set(server.id, server);
    }
  });

  return notifications.map((notification) => {
    const message = messageMap.get(notification.message_id) || null;
    const sender = message?.sender_id ? userMap.get(message.sender_id) || null : null;
    const channel = message?.channel_id ? channelMap.get(message.channel_id) || null : null;
    const server = channel?.server_id ? serverMap.get(channel.server_id) || null : null;

    return buildMentionNotificationResponse(notification, message, sender, channel, server);
  });
}

export type GetMentionsOptions = {
  userId: string | undefined;
  limit: unknown;
  unreadOnly: unknown;
  channelId?: string;
};

export const mentionService = {
  async getMentions({ userId, limit, unreadOnly, channelId }: GetMentionsOptions) {
    if (!userId) {
      throw new AppError(400, 'User ID is required');
    }

    const normalizedLimit = normalizeLimit(limit);
    const isUnreadOnly = unreadOnly === 'true';

    const userNotifications = await mentionRepository.getNotificationsForUser(userId);

    if (userNotifications.length === 0) {
      return [];
    }

    const { data: detailedNotifications, error: detailError } =
      await mentionRepository.getDetailedNotifications(userId, isUnreadOnly, channelId, normalizedLimit);

    if (detailError) {
      // Complex nested-join query failed - fall back to manual data fetching,
      // same as the original implementation.
      try {
        const filteredNotifications = userNotifications
          .filter((notification) => !isUnreadOnly || !notification.is_read)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, normalizedLimit);

        const manualNotifications = await buildManualMentionNotifications(filteredNotifications);

        return channelId
          ? manualNotifications.filter((notification) => notification.message.channel_id === channelId)
          : manualNotifications;
      } catch (manualError) {
        // Final fallback - return basic notifications, matching original behavior.
        return userNotifications.slice(0, normalizedLimit);
      }
    }

    return (
      detailedNotifications?.map((notification: any) => {
        const message = Array.isArray(notification.messages) ? notification.messages[0] : notification.messages;
        const user = Array.isArray(message?.users) ? message.users[0] : message?.users;
        const channel = Array.isArray(message?.channels) ? message.channels[0] : message?.channels;
        const server = Array.isArray(channel?.servers) ? channel.servers[0] : channel?.servers;

        return buildMentionNotificationResponse(notification, message, user, channel, server);
      }) || []
    );
  },

  async markMentionAsRead(mentionId: string, userId: string | undefined) {
    if (!userId) {
      throw new AppError(400, 'User ID is required');
    }

    await mentionRepository.markAsRead(mentionId, userId);
    await mentionRepository.deleteById(mentionId, userId);

    return { success: true };
  },

  async markAllMentionsAsRead(userId: string | undefined) {
    if (!userId) {
      throw new AppError(400, 'User ID is required');
    }

    const updated = await mentionRepository.markAllAsRead(userId);
    await mentionRepository.deleteAllRead(userId);

    return {
      success: true,
      updatedCount: updated.length,
      markedIds: updated.map((item) => item.id),
    };
  },

  async searchMentionable(serverId: string, query: string, userId?: string) {
    const results: { users: any[] } = { users: [] };

    // Original behavior treats member/user lookup failures as "no results"
    // rather than a request failure, so we fail soft here instead of
    // propagating an AppError.
    let members;
    try {
      members = await mentionRepository.getServerMembers(serverId, userId);
    } catch (error) {
      return results;
    }

    if (members.length === 0) {
      return results;
    }

    const memberUserIds = members.map((m) => m.user_id);
    const searchLimit = query && query.length > 0 ? 10 : 15;

    try {
      results.users = await mentionRepository.searchUsersByIds(memberUserIds, query, searchLimit);
    } catch (error) {
      return results;
    }

    return results;
  },
};