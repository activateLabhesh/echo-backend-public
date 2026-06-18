/**
 * Push Notification Service
 *
 * Sends notifications via Expo Push API.
 * Calls are fire-and-forget and should never block message delivery.
 */

import { supabase } from '../client/supabase';
import { checkChannelAccess } from '../controllers/channelController';
import { getUserSocket } from '../redis/userSocketStore';
import { userSocketMap } from '../sockets/chatSocket';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

const EXPO_TOKEN_RE = /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/;

type PushMessage = {
  to: string;
  title: string;
  subtitle?: string;
  body: string;
  data?: Record<string, any>;
  sound?: string;
  channelId?: string;
  collapseId?: string;
  tag?: string;
};

type AttachmentType = 'image' | 'audio' | 'file';

type AttachmentPreviewRow = {
  message_id?: string;
  dm_message_id?: string;
  attachment_type: AttachmentType;
};

const MAX_PREVIEW_MESSAGES = 3;
const PREVIEW_LINE_MAX = 90;
const PREVIEW_BODY_MAX = 360;
const DEFAULT_ANDROID_CHANNEL_ID = 'default';

function isExpoPushToken(token: string): boolean {
  return EXPO_TOKEN_RE.test(token);
}

function uniqueValidTokens(tokens: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const token of tokens) {
    if (typeof token !== 'string') continue;
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (!isExpoPushToken(trimmed)) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

async function removeInvalidTokensFromDb(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;

  const uniqueTokens = Array.from(new Set(tokens));
  const { error } = await supabase
    .from('user_push_tokens')
    .delete()
    .in('push_token', uniqueTokens);

  if (error) {

    return;
  }

}

/**
 * Fetch all push tokens for a user from the user_push_tokens table.
 */
async function getTokensForUser(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_push_tokens')
    .select('push_token')
    .eq('user_id', userId);

  if (error) {

    return [];
  }

  return uniqueValidTokens((data || []).map((row: any) => row.push_token));
}

/**
 * Fetch username by user ID.
 */
async function getUsername(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('users')
    .select('username')
    .eq('id', userId)
    .single();

  if (error || !data) return 'Someone';
  return data.username || 'Someone';
}

function normalizeMediaUrls(mediaUrl: unknown): string[] {
  if (typeof mediaUrl !== 'string') return [];
  const trimmed = mediaUrl.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => typeof item === 'string' && item.trim().length > 0);
      }
    } catch {
      return [trimmed];
    }
  }

  return [trimmed];
}

function toSingleLine(value: string, maxLen = PREVIEW_LINE_MAX): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function previewFromMessage(content: unknown, mediaUrl: unknown): string {
  const text = typeof content === 'string' ? content.trim() : '';
  if (text) return toSingleLine(text);

  const mediaUrls = normalizeMediaUrls(mediaUrl);
  if (mediaUrls.length > 0) return 'Sent an attachment';
  return 'New message';
}

function previewFromMessageWithAttachments(
  content: unknown,
  mediaUrl: unknown,
  attachments: AttachmentPreviewRow[] = []
): string {
  const text = typeof content === 'string' ? content.trim() : '';
  if (text) return toSingleLine(text);

  if (attachments.some((attachment) => attachment.attachment_type === 'audio')) {
    return 'Sent a voice message';
  }

  return previewFromMessage(content, mediaUrl);
}

function buildAttachmentPreviewMap<T extends AttachmentPreviewRow>(
  rows: T[],
  key: 'message_id' | 'dm_message_id'
): Map<string, T[]> {
  const map = new Map<string, T[]>();

  rows.forEach((row) => {
    const id = row[key];
    if (!id) return;

    const existing = map.get(id) || [];
    existing.push(row);
    map.set(id, existing);
  });

  return map;
}

function buildPreviewBody(lines: string[]): string {
  const normalized = lines
    .map((line) => toSingleLine(line))
    .filter((line) => line.length > 0)
    .slice(-MAX_PREVIEW_MESSAGES);

  if (normalized.length === 0) return 'New message';

  let body = normalized.join('\n');
  if (body.length <= PREVIEW_BODY_MAX) return body;
  body = body.slice(0, PREVIEW_BODY_MAX - 3).trimEnd();
  return `${body}...`;
}

function buildDmNotificationKey(threadId: string | undefined, senderId: string): string {
  return `dm:${threadId || senderId}`;
}

function buildChannelNotificationKey(channelId: string): string {
  return `channel:${channelId}`;
}

function withConversationCollapse<T extends Omit<PushMessage, 'to'> & { data?: Record<string, any> }>(
  message: T,
  groupKey: string,
): T & Pick<PushMessage, 'channelId' | 'collapseId' | 'tag'> {
  return {
    ...message,
    channelId: DEFAULT_ANDROID_CHANNEL_ID,
    collapseId: groupKey,
    tag: groupKey,
    data: {
      ...message.data,
      groupKey,
    },
  };
}

async function isUserOnline(userId: string): Promise<boolean> {
  if (userSocketMap.has(userId)) return true;

  try {
    const socketId = await getUserSocket(userId);
    return Boolean(socketId);
  } catch {
    return false;
  }
}

async function getLatestDmPreviewLines(threadId: string, senderId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('dm_messages')
    .select('id, content, media_url, timestamp')
    .eq('thread_id', threadId)
    .eq('sender_id', senderId)
    .order('timestamp', { ascending: false })
    .limit(MAX_PREVIEW_MESSAGES);

  if (error || !data || data.length === 0) return [];

  const messageIds = data.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
  let attachmentsByMessageId = new Map<string, AttachmentPreviewRow[]>();

  if (messageIds.length > 0) {
    const { data: attachmentRows, error: attachmentError } = await supabase
      .from('dm_message_attachments')
      .select('dm_message_id, attachment_type')
      .in('dm_message_id', messageIds);

    if (!attachmentError && attachmentRows) {
      attachmentsByMessageId = buildAttachmentPreviewMap(
        attachmentRows as AttachmentPreviewRow[],
        'dm_message_id'
      );
    }
  }

  return data
    .slice()
    .reverse()
    .map((msg: any) => previewFromMessageWithAttachments(
      msg.content,
      msg.media_url,
      attachmentsByMessageId.get(msg.id) || []
    ));
}

async function getLatestChannelPreviewLines(
  channelId: string,
  excludedUserId?: string,
): Promise<string[]> {
  let query = supabase
    .from('messages')
    .select(`
      id,
      content,
      media_url,
      timestamp,
      sender:users!sender_id (
        username
      )
    `)
    .eq('channel_id', channelId)
    .order('timestamp', { ascending: false })
    .limit(MAX_PREVIEW_MESSAGES);

  if (excludedUserId) {
    query = query.neq('sender_id', excludedUserId);
  }

  const { data, error } = await query;

  if (error || !data || data.length === 0) return [];

  const messageIds = data.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
  let attachmentsByMessageId = new Map<string, AttachmentPreviewRow[]>();

  if (messageIds.length > 0) {
    const { data: attachmentRows, error: attachmentError } = await supabase
      .from('message_attachments')
      .select('message_id, attachment_type')
      .in('message_id', messageIds);

    if (!attachmentError && attachmentRows) {
      attachmentsByMessageId = buildAttachmentPreviewMap(
        attachmentRows as AttachmentPreviewRow[],
        'message_id'
      );
    }
  }

  return data
    .slice()
    .reverse()
    .map((msg: any) => {
      const senderName = msg?.sender?.username || 'Someone';
      const preview = previewFromMessageWithAttachments(
        msg?.content,
        msg?.media_url,
        attachmentsByMessageId.get(msg?.id) || []
      );
      return `${toSingleLine(senderName, 24)}: ${preview}`;
    });
}

/**
 * Send push notifications to a list of Expo push tokens.
 * Supports batching (Expo allows up to 100 messages per request).
 */
async function sendExpoPush(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const chunks: PushMessage[][] = [];
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    chunks.push(messages.slice(i, i + EXPO_BATCH_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const text = await response.text();

        continue;
      }

      const payload = await response.json().catch(() => null);
      const tickets = Array.isArray(payload?.data) ? payload.data : [];
      const invalidTokens: string[] = [];

      for (let i = 0; i < tickets.length && i < chunk.length; i += 1) {
        const ticket = tickets[i];
        if (ticket?.status !== 'error') continue;

        const ticketError = ticket?.message || ticket?.details?.error || 'unknown_error';

        // Expo recommends removing DeviceNotRegistered tokens.
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          invalidTokens.push(chunk[i].to);
        }
      }

      if (invalidTokens.length > 0) {
        await removeInvalidTokensFromDb(invalidTokens);
      }

    } catch (err: any) {

    }
  }
}

/**
 * Send a push notification to a DM recipient.
 * Should be called after a DM is saved and emitted via socket.
 */
export async function sendDmPushNotification(
  senderId: string,
  receiverId: string,
  messagePreview: string,
  threadId?: string
): Promise<void> {
  try {
    if (senderId === receiverId) return;

    const tokens = await getTokensForUser(receiverId);
    if (tokens.length === 0) {

      return;
    }

    const senderName = await getUsername(senderId);

    let previewLines: string[] = [];
    if (threadId) {
      previewLines = await getLatestDmPreviewLines(threadId, senderId);
    }
    if (previewLines.length === 0) {
      previewLines = [previewFromMessage(messagePreview, null)];
    }

    const body = buildPreviewBody(previewLines);
    const messageCount = previewLines.length;
    const groupKey = buildDmNotificationKey(threadId, senderId);
    const baseMessage = withConversationCollapse(
      {
        title: senderName,
        ...(messageCount > 1 ? { subtitle: `${messageCount} new messages` } : {}),
        body,
        sound: 'default',
        data: {
          type: 'dm',
          senderId,
          receiverId,
          threadId: threadId || null,
          previewLines: previewLines.slice(-MAX_PREVIEW_MESSAGES),
        },
      },
      groupKey,
    );

    const messages: PushMessage[] = tokens.map((token) => ({
      to: token,
      ...baseMessage,
    }));

    await sendExpoPush(messages);
  } catch (err: any) {

  }
}

/**
 * Send push notifications to offline members of a channel when a new message is sent.
 */
export async function sendChannelPushNotification(
  senderId: string,
  channelId: string,
  messagePreview: string
): Promise<void> {
  try {
    // 1) Get channel info.
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('name, server_id')
      .eq('id', channelId)
      .single();

    if (channelError || !channel) {

      return;
    }

    // 2) Get server members except sender.
    const { data: members, error: membersError } = await supabase
      .from('server_members')
      .select('user_id')
      .eq('server_id', channel.server_id)
      .neq('user_id', senderId);

    if (membersError || !members || members.length === 0) {
      return;
    }

    // 3) Keep only offline members.
    const offlineUserIds: string[] = [];
    for (const member of members) {
      const localSocket = userSocketMap.get(member.user_id);
      if (localSocket) continue;

      let redisSocket: string | null = null;
      try {
        redisSocket = await getUserSocket(member.user_id);
      } catch (error: any) {

      }

      if (redisSocket) continue;
      offlineUserIds.push(member.user_id);
    }

    if (offlineUserIds.length === 0) {

      return;
    }

    // 4) Respect channel visibility rules (avoid notifying users with no access).
    const allowedOfflineUserIds: string[] = [];
    for (const userId of offlineUserIds) {
      try {
        const canView = await checkChannelAccess(userId, channelId);
        if (canView) allowedOfflineUserIds.push(userId);
      } catch (error: any) {

      }
    }

    if (allowedOfflineUserIds.length === 0) {

      return;
    }

    // 5) Fetch push tokens for eligible users.
    const { data: tokenRows, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('user_id, push_token')
      .in('user_id', allowedOfflineUserIds);

    if (tokenError || !tokenRows || tokenRows.length === 0) {

      return;
    }

    // 6) Build and send push messages.
    const channelName = channel.name || 'channel';
    const groupKey = buildChannelNotificationKey(channelId);
    const sentTokens = new Set<string>();
    const messages: PushMessage[] = [];

    for (const recipientId of allowedOfflineUserIds) {
      const tokens = uniqueValidTokens(
        tokenRows
          .filter((row: any) => row.user_id === recipientId)
          .map((row: any) => row.push_token),
      ).filter((token) => !sentTokens.has(token));

      if (tokens.length === 0) continue;

      let previewLines = await getLatestChannelPreviewLines(channelId, recipientId);

      if (previewLines.length === 0) {
        const senderName = await getUsername(senderId);
        const fallbackPreview = previewFromMessage(messagePreview, null);
        previewLines = [`${toSingleLine(senderName, 24)}: ${fallbackPreview}`];
      }

      const body = buildPreviewBody(previewLines);
      const messageCount = previewLines.length;
      const baseMessage = withConversationCollapse(
        {
          title: `#${channelName}`,
          ...(messageCount > 1 ? { subtitle: `${messageCount} new messages` } : {}),
          body,
          sound: 'default',
          data: {
            type: 'channel_message',
            channelId,
            serverId: channel.server_id,
            previewLines: previewLines.slice(-MAX_PREVIEW_MESSAGES),
          },
        },
        groupKey,
      );

      for (const token of tokens) {
        sentTokens.add(token);
        messages.push({
          to: token,
          ...baseMessage,
        });
      }
    }

    await sendExpoPush(messages);
  } catch (err: any) {

  }
}

export async function sendReactionPushNotification(
  reactorId: string,
  recipientId: string,
  emoji: string,
  payload:
    | {
        kind: 'channel';
        channelId: string;
        serverId: string;
        channelName: string;
        messageId: string;
      }
    | {
        kind: 'dm';
        threadId: string;
        dmMessageId: string;
      },
): Promise<void> {
  if (reactorId === recipientId) return;

  try {
    const online = await isUserOnline(recipientId);
    if (online) return;

    const tokens = await getTokensForUser(recipientId);
    if (tokens.length === 0) return;

    const reactorName = await getUsername(reactorId);
    const isDm = payload.kind === 'dm';
    const groupKey = isDm
      ? buildDmNotificationKey(payload.threadId, reactorId)
      : buildChannelNotificationKey(payload.channelId);
    const title = isDm ? reactorName : `#${payload.channelName}`;
    const reactionLine = `${reactorName} reacted ${emoji} to your message`;
    const previewLines = isDm
      ? await getLatestDmPreviewLines(payload.threadId, reactorId)
      : await getLatestChannelPreviewLines(payload.channelId, recipientId);
    const body = buildPreviewBody([...previewLines, reactionLine]);
    const baseMessage = withConversationCollapse(
      {
        title,
        body,
        sound: 'default',
        data: isDm
          ? {
              type: 'dm_reaction',
              threadId: payload.threadId,
              dmMessageId: payload.dmMessageId,
              senderId: reactorId,
              reactorId,
              emoji,
            }
          : {
              type: 'channel_reaction',
              serverId: payload.serverId,
              channelId: payload.channelId,
              messageId: payload.messageId,
              reactorId,
              emoji,
            },
      },
      groupKey,
    );

    const messages: PushMessage[] = tokens.map((token) => ({
      to: token,
      ...baseMessage,
    }));

    await sendExpoPush(messages);
  } catch (err: any) {
    console.error('[PushNotification] sendReactionPushNotification error:', err?.message || err);
  }
}
