import { Request, Response } from "express";
import { v4 } from 'uuid';
import { supabase } from '../client/supabase';
import { parseMentions, processMentions, resolveMentions } from '../lib/mentionParser';
import { extractGifMediaUrl } from '../lib/messageMedia';
import { sendReactionPushNotification } from "../notifications/pushNotificationService";
import { sendChannelPushNotification, sendDmPushNotification } from '../notifications/pushNotificationService';
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { getUserSocket } from "../redis/userSocketStore";
import { getIO, userSocketMap } from "../sockets/chatSocket";
import { checkChannelAccess, checkChannelSendPermission } from './channelController';
import { UploadedAttachment,MessageAttachmentRecord, MediaItem } from "../types/attachment.types";
import { ChannelMessageBody } from "../types/message.types";
import { DmMessageBody } from "../types/dmMessage.types";
import { MessageReactionSummary } from "../types/reaction.types";
import { MessagePinRecord } from "../types/pin.types";
import * as messageServices from '../services/messageService'
import * as dmService from '../services/dmService'


function sniffImageMime(buffer: Buffer): { mime: string; ext: string } | null {
    // ... (Your existing sniffImageMime function content)
    if (!buffer || buffer.length < 4) return null;
    const b0 = buffer[0], b1 = buffer[1], b2 = buffer[2], b3 = buffer[3];
    if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
    if (buffer.length >= 8 && b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
    if (buffer.length >= 6) {
        const sig = buffer.slice(0, 6).toString('ascii');
        if (sig === 'GIF87a' || sig === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
    }
    if (buffer.length >= 12) {
        const riff = buffer.slice(0, 4).toString('ascii');
        const webp = buffer.slice(8, 12).toString('ascii');
        if (riff === 'RIFF' && webp === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
    }
    if (b0 === 0x42 && b1 === 0x4d) return { mime: 'image/bmp', ext: 'bmp' };
    const head = buffer.slice(0, Math.min(512, buffer.length)).toString('utf8').trimStart();
    if (head.startsWith('<?xml') || head.startsWith('<svg')) {
        if (head.includes('<svg')) return { mime: 'image/svg+xml', ext: 'svg' };
    }
    return null;
}

function getUploadedFiles(anyReq: any): Express.Multer.File[] {
    const files: Express.Multer.File[] = [];

    if (anyReq.file) {
        files.push(anyReq.file as Express.Multer.File);
    }

    if (anyReq.files) {
        if (Array.isArray(anyReq.files)) {
            files.push(...(anyReq.files as Express.Multer.File[]));
        } else {
            const filesObj = anyReq.files as Record<string, Express.Multer.File[]>;
            Object.values(filesObj).forEach((group) => {
                if (Array.isArray(group) && group.length) {
                    files.push(...group);
                }
            });
        }
    }

    return files;
}

function serializeMediaUrls(urls: string[]): string | null {
    if (!urls.length) return null;
    if (urls.length === 1) return urls[0];
    return JSON.stringify(urls);
}

function normalizeMediaUrls(mediaUrl: unknown): string[] {
    if (typeof mediaUrl !== 'string') return [];

    const trimmed = mediaUrl.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((item) => typeof item === 'string');
            }
        } catch {
            return [trimmed];
        }
    }

    return [trimmed];
}

function resolveGifMessageMedia(content: unknown, mediaUrl: string | null): { content: string; mediaUrl: string | null } {
    const gifMediaUrl = extractGifMediaUrl(content);

    return {
        content: gifMediaUrl ? '' : (typeof content === 'string' ? content : ''),
        mediaUrl: mediaUrl || gifMediaUrl,
    };
}

function withMediaUrls<T extends { media_url?: unknown }>(message: T): T & { media_urls: string[] } {
    return {
        ...message,
        media_urls: normalizeMediaUrls(message.media_url),
    };
}

function withMessageAttachments<T extends { media_url?: unknown }>(
    message: T,
    attachments: MessageAttachmentRecord[] = []
): T & { media_urls: string[]; attachments: MessageAttachmentRecord[] } {
    return {
        ...withMediaUrls(message),
        attachments,
    };
}

function withMessageReactions<T extends object>(
    message: T,
    reactions: MessageReactionSummary[] = []
): T & { reactions: MessageReactionSummary[] } {
    return {
        ...message,
        reactions,
    };
}

// function classifyAttachmentType(mimeType: string, originalName?: string): AttachmentType {
//     if (IMAGE_MIME_SET.has(mimeType)) {
//         return 'image';
//     }

//     if (mimeType.startsWith('audio/') || AUDIO_MIME_SET.has(mimeType)) {
//         return 'audio';
//     }

//     const extension = originalName?.split('.').pop()?.toLowerCase();
//     if (extension && AUDIO_FILE_EXT_SET.has(extension)) {
//         return 'audio';
//     }

//     return 'file';
// }

function parseDurationMs(rawValue: unknown): number | null {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue >= 0) {
        return Math.round(rawValue);
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.round(parsed);
        }
    }

    return null;
}

function getAttachmentPreview(message?: {
    attachments?: MessageAttachmentRecord[];
    media_urls?: unknown;
}): string {
    if (!message) return '';

    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        if (message.attachments.some((attachment) => attachment.attachment_type === 'audio')) {
            return '[Voice message]';
        }

        return '[Attachment]';
    }

    if (Array.isArray(message.media_urls) && message.media_urls.length > 0) {
        return '[Attachment]';
    }

    return '';
}

function normalizeEmoji(rawEmoji: unknown): string | null {
    if (typeof rawEmoji !== 'string') return null;

    const trimmed = rawEmoji.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function buildReactionSummary(rows: Array<{ emoji: string }>): MessageReactionSummary[] {
    const counts = new Map<string, number>();

    rows.forEach((row) => {
        counts.set(row.emoji, (counts.get(row.emoji) || 0) + 1);
    });

    return Array.from(counts.entries())
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }

            return left.emoji.localeCompare(right.emoji);
        });
}

function buildReactionMap<T extends 'message_id' | 'dm_message_id'>(
    rows: Array<Record<T, string | null> & { emoji: string }>,
    key: T
): Map<string, MessageReactionSummary[]> {
    const grouped = new Map<string, Array<{ emoji: string }>>();

    rows.forEach((row) => {
        const targetId = row[key];
        if (!targetId) return;

        const existing = grouped.get(targetId) || [];
        existing.push({ emoji: row.emoji });
        grouped.set(targetId, existing);
    });

    const reactionMap = new Map<string, MessageReactionSummary[]>();
    grouped.forEach((reactionRows, targetId) => {
        reactionMap.set(targetId, buildReactionSummary(reactionRows));
    });

    return reactionMap;
}

async function getChannelReactionMap(messageIds: string[]): Promise<Map<string, MessageReactionSummary[]>> {
    if (messageIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('message_reactions')
        .select('message_id, emoji')
        .in('message_id', messageIds);

    if (error) {
        throw error;
    }

    return buildReactionMap((data || []) as Array<{ message_id: string | null; emoji: string }>, 'message_id');
}

async function getDmReactionMap(dmMessageIds: string[]): Promise<Map<string, MessageReactionSummary[]>> {
    if (dmMessageIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('message_reactions')
        .select('dm_message_id, emoji')
        .in('dm_message_id', dmMessageIds);

    if (error) {
        throw error;
    }

    return buildReactionMap((data || []) as Array<{ dm_message_id: string | null; emoji: string }>, 'dm_message_id');
}

async function getChannelMessageContext(messageId: string): Promise<{ channelId: string; senderId: string } | null> {
    const result = await messageServices.getChannelMessageContext(messageId)

    return {channelId: result.channelId, senderId: result.senderId}

}

async function getDmMessageContext(messageId: string): Promise<{ threadId: string; user1Id: string; user2Id: string; senderId: string } | null> {

    if(!messageId){
        throw new Error("No message id found, please enter a messageid");
    }

    const result = await dmService.getdmMessageContext(messageId);

    return result;

}

async function getMessageReactionSummary(messageId: string): Promise<MessageReactionSummary[]> {
    const { data, error } = await supabase
        .from('message_reactions')
        .select('emoji')
        .eq('message_id', messageId);

    if (error) {
        throw error;
    }

    return buildReactionSummary((data || []) as Array<{ emoji: string }>);
}

async function getDmMessageReactionSummary(dmMessageId: string): Promise<MessageReactionSummary[]> {
    const { data, error } = await supabase
        .from('message_reactions')
        .select('emoji')
        .eq('dm_message_id', dmMessageId);

    if (error) {
        throw error;
    }

    return buildReactionSummary((data || []) as Array<{ emoji: string }>);
}

async function uploadMessageAttachments(req: Request, res: Response){
    let uploadedAttachments: UploadedAttachment[] = [];
    let media_url: string | null = null;

    const body = req.body as ChannelMessageBody;

    const durationMs =
        parseDurationMs(body.duration_ms);

    const uploadedFiles =
        getUploadedFiles(req as any);


    try {

    const uploadResult =
        await messageServices.uploadMessageAttachments(
            uploadedFiles,
            durationMs
        );

    uploadedAttachments =
        uploadResult.attachments;

    media_url =
        uploadResult.mediaUrl;

        console.log("attachment is uploaded")

    } catch (error) {

        return res.status(500).json({
            error: "Upload failed"
        });

    }
}

async function insertChannelMessageAttachments(
    messageId: string,
    attachments: UploadedAttachment[]
): Promise<MessageAttachmentRecord[]> {
    if (attachments.length === 0) return [];

    const { data, error } = await supabase
        .from('message_attachments')
        .insert(attachments.map((attachment) => ({ message_id: messageId, ...attachment })))
        .select('*');

    if (error) {
        throw error;
    }

    return (data as MessageAttachmentRecord[] | null) || [];
}

async function insertDmMessageAttachments(
    messageId: string,
    attachments: UploadedAttachment[]
): Promise<MessageAttachmentRecord[]> {
    if (attachments.length === 0) return [];

    const { data, error } = await supabase
        .from('dm_message_attachments')
        .insert(attachments.map((attachment) => ({ dm_message_id: messageId, ...attachment })))
        .select('*');

    if (error) {
        throw error;
    }

    return (data as MessageAttachmentRecord[] | null) || [];
}

function buildAttachmentMap<T>(
    rows: T[],
    getMessageId: (row: T) => string | undefined
): Map<string, T[]> {
    const map = new Map<string, T[]>();

    rows.forEach((row) => {
        const messageId = getMessageId(row);
        if (!messageId) return;

        const existing = map.get(messageId) || [];
        existing.push(row);
        map.set(messageId, existing);
    });

    return map;
}

async function getChannelAttachmentMap(messageIds: string[]): Promise<Map<string, MessageAttachmentRecord[]>> {
    if (messageIds.length === 0) return new Map();

    const { data, error } = await supabase
        .from('message_attachments')
        .select('*')
        .in('message_id', messageIds)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    return buildAttachmentMap((data as MessageAttachmentRecord[] | null) || [], (row) => row.message_id);
}

async function getDmAttachmentMap(messageIds: string[]): Promise<Map<string, MessageAttachmentRecord[]>> {
    if (messageIds.length === 0) return new Map();

    const { data, error } = await supabase
        .from('dm_message_attachments')
        .select('*')
        .in('dm_message_id', messageIds)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    return buildAttachmentMap((data as MessageAttachmentRecord[] | null) || [], (row) => row.dm_message_id);
}

function getDmPreview(message?: { content?: unknown; media_urls?: unknown }): string {
    if (!message) return '';

    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;

    return getAttachmentPreview(message as { attachments?: MessageAttachmentRecord[]; media_urls?: unknown });
}


    export const messageGetController = async ( req: Request, res: Response ) => {
        try {
            const channelId = req.query.channel_id as string;
            const offset = Number(req.query.offset || 0);

            if (!channelId) {
                res.status(400).json({ msg: 'Invalid channelId received' });
                return;
            }

            const result = await messageServices.getMessages(channelId, offset);

            res.status(200).json(result);
        } catch (e) {
            res.status(500).json({ msg: 'Server Error' });
        }
    }

export const channelmessagePostController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const body = req.body as ChannelMessageBody;
        const senderId = req.user?.sub || body.sender_id;
        const channelId = body.channel_id;
        const content = body?.content ?? '';
        const replyTo = body.reply_to || null;
        const durationMs = parseDurationMs(body.duration_ms);
        const uploadedFiles = getUploadedFiles(req as any);

        if (!senderId) {
            res.status(400).json({ error: 'Invalid sender_id format.' });
            return;
        }

        if (!channelId) {
            res.status(400).json({ error: 'Invalid channel_id format.' });
            return;
        }

        if (!content && uploadedFiles.length === 0) {
            res.status(400).json({ error: 'Message content or a file is required.' });
            return;
        }

        const result = await messageServices.sendChannelMessage({
            senderId,
            channelId,
            content,
            replyTo,
            durationMs,
            files: uploadedFiles,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: 'Server Error' });
    }
};

export const dmMessagePostController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const body = req.body as DmMessageBody;
        const senderId = req.user?.sub;
        const receiverId = body.receiver_id;
        const content = body?.content ?? '';
        const replyTo = body?.reply_to ?? null;
        const durationMs = parseDurationMs(body.duration_ms);
        const uploadedFiles = getUploadedFiles(req as any);

        if (!senderId) {
            res.status(400).json({ error: 'Invalid sender_id format.' });
            return;
        }

        if (!receiverId) {
            res.status(400).json({ error: 'Invalid receiver_id format.' });
            return;
        }

        if (!content && uploadedFiles.length === 0) {
            res.status(400).json({ error: 'Message content or a file is required.' });
            return;
        }

        const result = await dmService.sendDmMessage({
            senderId,
            receiverId,
            content,
            replyTo,
            durationMs,
            files: uploadedFiles,
        });

        res.status(200).json(result);
    } catch (error: any) {
        console.error('Error in dmMessagePostController:', error);
        res.status(error.status || 500).json({ error: error.message || 'Server Error' });
    }
};


type ReactionTarget =
    | { kind: 'channel'; messageId: string; channelId: string; messageOwnerId: string }
    | { kind: 'dm'; messageId: string; threadId: string; user1Id: string; user2Id: string; messageOwnerId: string };

async function resolveReactionTarget(userId: string, messageId?: string, dmMessageId?: string): Promise<ReactionTarget | { error: string; status: number }> {
    if ((messageId && dmMessageId) || (!messageId && !dmMessageId)) {
        return { error: 'Provide exactly one of message_id or dm_message_id.', status: 400 };
    }

    if (messageId) {
        const context = await getChannelMessageContext(messageId);
        if (!context) {
            return { error: 'Message not found.', status: 404 };
        }

        const canAccess = await checkChannelAccess(userId, context.channelId);
        if (!canAccess) {
            return { error: 'You do not have access to this channel.', status: 403 };
        }

        return {
            kind: 'channel',
            messageId,
            channelId: context.channelId,
            messageOwnerId: context.senderId,
        };
    }

    const context = await getDmMessageContext(dmMessageId as string);
    if (!context) {
        return { error: 'DM message not found.', status: 404 };
    }

    if (context.user1Id !== userId && context.user2Id !== userId) {
        return { error: 'You do not have access to this DM thread.', status: 403 };
    }

    return {
        kind: 'dm',
        messageId: dmMessageId as string,
        threadId: context.threadId,
        user1Id: context.user1Id,
        user2Id: context.user2Id,
        messageOwnerId: context.senderId,
    };
}

async function emitReactionUpdate(target: ReactionTarget, reactions: MessageReactionSummary[]) {
    const io = getIO();

    if (target.kind === 'channel') {
        io.to(target.channelId).emit('message_reaction_updated', {
            message_id: target.messageId,
            reactions,
        });
        return;
    }

    const recipients = Array.from(new Set([target.user1Id, target.user2Id]));
    await Promise.all(recipients.map(async (recipientId) => {
        const socketId = userSocketMap.get(recipientId) ?? await getUserSocket(recipientId);
        if (socketId) {
            io.to(socketId).emit('dm_message_reaction_updated', {
                dm_message_id: target.messageId,
                thread_id: target.threadId,
                reactions,
            });
        }
    }));
}

export const toggleMessageReaction = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.sub;

    const { message_id, dm_message_id, emoji } = req.body;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const normalizedEmoji = normalizeEmoji(emoji);

    if (!normalizedEmoji) {
      res.status(400).json({ error: "emoji is required" });
      return;
    }

    const targetResult = await resolveReactionTarget(
      userId,
      message_id,
      dm_message_id
    );

    if ("error" in targetResult) {
      res.status(targetResult.status).json({
        error: targetResult.error,
      });
      return;
    }

    const target = targetResult;

    const reactionQuery =
      target.kind === "channel"
        ? supabase
            .from("message_reactions")
            .select("id")
            .eq("message_id", target.messageId)
            .eq("user_id", userId)
            .eq("emoji", normalizedEmoji)
        : supabase
            .from("message_reactions")
            .select("id")
            .eq("dm_message_id", target.messageId)
            .eq("user_id", userId)
            .eq("emoji", normalizedEmoji);

    const { data: existingReaction, error: reactionError } =
      await reactionQuery.maybeSingle();

    if (reactionError && reactionError.code !== "PGRST116") {
      res.status(500).json({
        error: reactionError.message,
      });
      return;
    }

    let action: "added" | "removed";

    if (existingReaction) {
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .eq("id", existingReaction.id);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      action = "removed";
    } else {
      const payload =
        target.kind === "channel"
          ? {
              message_id: target.messageId,
              dm_message_id: null,
              user_id: userId,
              emoji: normalizedEmoji,
            }
          : {
              message_id: null,
              dm_message_id: target.messageId,
              user_id: userId,
              emoji: normalizedEmoji,
            };

      const { error } = await supabase
        .from("message_reactions")
        .insert(payload);

      if (error) {
        res.status(500).json({
          error: error.message,
        });
        return;
      }

      action = "added";
    }

    const reactions =
      target.kind === "channel"
        ? await getMessageReactionSummary(target.messageId)
        : await getDmMessageReactionSummary(target.messageId);

    if (action === "added" && target.messageOwnerId !== userId) {
      try {
        if (target.kind === "channel") {
          const { data: channel } = await supabase
            .from("channels")
            .select("name, server_id")
            .eq("id", target.channelId)
            .maybeSingle();

          await sendReactionPushNotification(
            userId,
            target.messageOwnerId,
            normalizedEmoji,
            {
              kind: "channel",
              channelId: target.channelId,
              serverId: channel?.server_id || "",
              channelName: channel?.name || "channel",
              messageId: target.messageId,
            }
          );
        } else {
          await sendReactionPushNotification(
            userId,
            target.messageOwnerId,
            normalizedEmoji,
            {
              kind: "dm",
              threadId: target.threadId,
              dmMessageId: target.messageId,
            }
          );
        }
      } catch (pushError: any) {
        console.error("Failed to send reaction push notification:", pushError?.message || pushError);
      }
    }

    await emitReactionUpdate(target, reactions);

    res.status(200).json({
      action,
      data:
        target.kind === "channel"
          ? {
              message_id: target.messageId,
              reactions,
            }
          : {
              dm_message_id: target.messageId,
              reactions,
            },
    });
  } catch (error: any) {
    console.error(error);

    res.status(500).json({
      error: error.message || "Server Error",
    });
  }
};
export const getMessageReactions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const messageId = (req.query?.message_id as string) || undefined;
        const dmMessageId = (req.query?.dm_message_id as string) || undefined;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const targetResult = await resolveReactionTarget(userId, messageId, dmMessageId);
        if ('error' in targetResult) {
            res.status(targetResult.status).json({ error: targetResult.error });
            return;
        }

        const reactions = targetResult.kind === 'channel'
            ? await getMessageReactionSummary(targetResult.messageId)
            : await getDmMessageReactionSummary(targetResult.messageId);

        res.status(200).json({
            data: targetResult.kind === 'channel'
                ? { message_id: targetResult.messageId, reactions }
                : { dm_message_id: targetResult.messageId, reactions },
        });
    } catch (error: any) {
        console.error('Error in getMessageReactions:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

function normalizeSearchTerm(rawValue: unknown): string {
    if (typeof rawValue !== 'string') return '';
    return rawValue.trim();
}

function buildMediaItems(messages: Array<any>, attachmentsByMessageId: Map<string, MessageAttachmentRecord[]>): MediaItem[] {
    const items: MediaItem[] = [];

    messages.forEach((message) => {
        const messageAttachments = attachmentsByMessageId.get(message.id) || [];
        messageAttachments.forEach((attachment) => {
            items.push({
                attachment_id: attachment.id || attachment.storage_path,
                message_id: message.id,
                url: attachment.url,
                storage_path: attachment.storage_path,
                mime_type: attachment.mime_type,
                attachment_type: attachment.attachment_type,
                file_name: attachment.file_name,
                file_size: attachment.file_size,
                duration_ms: attachment.duration_ms,
                created_at: attachment.created_at,
                message_content: message.content || null,
                timestamp: message.timestamp,
                sender: message.sender
                    ? {
                        id: message.sender.id,
                        username: message.sender.username || null,
                        avatar_url: message.sender.avatar_url || null,
                    }
                    : null,
            });
        });
    });

    return items.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
}

function buildPinnedMessagePayload(message: any, pin: MessagePinRecord, attachments: MessageAttachmentRecord[], reactions: MessageReactionSummary[]) {
    return {
        ...withMessageAttachments(message, attachments),
        ...withMessageReactions(message, reactions),
        pinned_at: pin.created_at || null,
        pinned_by: pin.pinned_by,
        username: message.sender?.username || null,
        sender_avatar_url: message.sender?.avatar_url || null,
    };
}

async function emitPinUpdate(target: ReactionTarget, isPinned: boolean) {
    const io = getIO();

    if (target.kind === 'channel') {
        io.to(target.channelId).emit(isPinned ? 'message_pinned' : 'message_unpinned', {
            message_id: target.messageId,
        });
        return;
    }

    const recipients = Array.from(new Set([target.user1Id, target.user2Id]));
    await Promise.all(recipients.map(async (recipientId) => {
        const socketId = userSocketMap.get(recipientId) ?? await getUserSocket(recipientId);
        if (socketId) {
            io.to(socketId).emit(isPinned ? 'dm_message_pinned' : 'dm_message_unpinned', {
                dm_message_id: target.messageId,
                thread_id: target.threadId,
            });
        }
    }));
}

async function resolvePinTarget(userId: string, messageId?: string, dmMessageId?: string): Promise<ReactionTarget | { error: string; status: number }> {
    if ((messageId && dmMessageId) || (!messageId && !dmMessageId)) {
        return { error: 'Provide exactly one of message_id or dm_message_id.', status: 400 };
    }

    if (messageId) {
        const context = await getChannelMessageContext(messageId);
        if (!context) {
            return { error: 'Message not found.', status: 404 };
        }

        const canAccess = await checkChannelAccess(userId, context.channelId);
        if (!canAccess) {
            return { error: 'You do not have access to this channel.', status: 403 };
        }

        return {
            kind: 'channel',
            messageId,
            channelId: context.channelId,
            messageOwnerId: context.senderId,
        };
    }

    const context = await getDmMessageContext(dmMessageId as string);
    if (!context) {
        return { error: 'DM message not found.', status: 404 };
    }

    if (context.user1Id !== userId && context.user2Id !== userId) {
        return { error: 'You do not have access to this DM thread.', status: 403 };
    }

    return {
        kind: 'dm',
        messageId: dmMessageId as string,
        threadId: context.threadId,
        user1Id: context.user1Id,
        user2Id: context.user2Id,
        messageOwnerId: context.senderId,
    };
}

export const searchChannelMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const { serverId } = req.params;
        const query = normalizeSearchTerm(req.query?.q);

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!serverId) {
            res.status(400).json({ error: 'Server ID is required.' });
            return;
        }

        if (!query) {
            res.status(400).json({ error: 'Search query is required.' });
            return;
        }

        const result = await messageServices.searchChannelMessages(userId, serverId, query);

        res.status(200).json(result);
    } catch (error: any) {
        console.error('Error in searchChannelMessages:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

export const searchDmMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const { threadId } = req.params;
        const query = normalizeSearchTerm(req.query?.q);

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!threadId) {
            res.status(400).json({ error: 'Thread ID is required.' });
            return;
        }

        if (!query) {
            res.status(400).json({ error: 'Search query is required.' });
            return;
        }

        const result = await dmService.searchDmMessages(userId, threadId, query);

        res.status(200).json(result);
    } catch (error: any) {
        console.error('Error in searchDmMessages:', error);
        res.status(error.status || 500).json({ error: error.message || 'Server error' });
    }
};

export const getChannelMedia = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const { serverId } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!serverId) {
            res.status(400).json({ error: 'Server ID is required.' });
            return;
        }

        const result = await messageServices.getChannelMedia(userId, serverId);

        res.status(200).json(result);
    } catch (error: any) {
        console.error('Error in getChannelMedia:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

export const getDmMedia = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const { threadId } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!threadId) {
            res.status(400).json({ error: 'Thread ID is required.' });
            return;
        }

        const result = await dmService.getDmMedia(userId, threadId);

        res.status(200).json(result);
    } catch (error: any) {
        console.error('Error in getDmMedia:', error);
        res.status(error.status || 500).json({ error: error.message || 'Server error' });
    }
};

export const getPinnedMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const channelId = (req.query?.channel_id as string) || undefined;
        const threadId = (req.query?.thread_id as string) || undefined;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if ((channelId && threadId) || (!channelId && !threadId)) {
            res.status(400).json({ error: 'Provide exactly one of channel_id or thread_id.' });
            return;
        }

        if (channelId) {
            const canAccess = await checkChannelAccess(userId, channelId);
            if (!canAccess) {
                res.status(403).json({ error: 'You do not have access to this channel.' });
                return;
            }

            const { data: messages, error: messageError } = await supabase
                .from('messages')
                .select('id')
                .eq('channel_id', channelId);

            if (messageError) {
                res.status(500).json({ error: messageError.message });
                return;
            }

            const messageIds = ((messages || []) as Array<{ id: string }>).map((message) => message.id);
            if (messageIds.length === 0) {
                res.status(200).json({ data: [] });
                return;
            }

            const { data: pins, error: pinError } = await supabase
                .from('message_pins')
                .select('id, message_id, pinned_by, created_at')
                .in('message_id', messageIds)
                .order('created_at', { ascending: false });

            if (pinError) {
                res.status(500).json({ error: pinError.message });
                return;
            }

            const pinRows = (pins || []) as MessagePinRecord[];
            const pinnedMessageIds = pinRows.map((pin) => pin.message_id).filter((id): id is string => typeof id === 'string');
            const [messageResult, attachmentsByMessageId, reactionsByMessageId] = await Promise.all([
                supabase
                    .from('messages')
                    .select(`
                        *,
                        sender:users!sender_id (
                            id,
                            username,
                            avatar_url
                        )
                    `)
                    .in('id', pinnedMessageIds),
                getChannelAttachmentMap(pinnedMessageIds),
                getChannelReactionMap(pinnedMessageIds),
            ]);

            if (messageResult.error) {
                res.status(500).json({ error: messageResult.error.message });
                return;
            }

            const messagesMap = new Map<string, any>();
            ((messageResult.data || []) as Array<any>).forEach((message) => messagesMap.set(message.id, message));

            res.status(200).json({
                data: pinRows
                    .map((pin) => {
                        const message = messagesMap.get(pin.message_id || '');
                        if (!message) return null;
                        return buildPinnedMessagePayload(
                            message,
                            pin,
                            attachmentsByMessageId.get(pin.message_id || '') || [],
                            reactionsByMessageId.get(pin.message_id || '') || []
                        );
                    })
                    .filter((item): item is NonNullable<typeof item> => Boolean(item)),
            });
            return;
        }

        const threadResult = await supabase
            .from('dm_threads')
            .select('id, user1_id, user2_id')
            .eq('id', threadId)
            .maybeSingle();

        if (threadResult.error) {
            res.status(500).json({ error: threadResult.error.message });
            return;
        }

        if (!threadResult.data || (threadResult.data.user1_id !== userId && threadResult.data.user2_id !== userId)) {
            res.status(403).json({ error: 'You do not have access to this DM thread.' });
            return;
        }

        const { data: messages, error: messageError } = await supabase
            .from('dm_messages')
            .select('id')
            .eq('thread_id', threadId);

        if (messageError) {
            res.status(500).json({ error: messageError.message });
            return;
        }

        const messageIds = ((messages || []) as Array<{ id: string }>).map((message) => message.id);
        if (messageIds.length === 0) {
            res.status(200).json({ data: [] });
            return;
        }

        const { data: pins, error: pinError } = await supabase
            .from('message_pins')
            .select('id, dm_message_id, pinned_by, created_at')
            .in('dm_message_id', messageIds)
            .order('created_at', { ascending: false });

        if (pinError) {
            res.status(500).json({ error: pinError.message });
            return;
        }

        const pinRows = (pins || []) as MessagePinRecord[];
        const pinnedMessageIds = pinRows.map((pin) => pin.dm_message_id).filter((id): id is string => typeof id === 'string');
        const [messageResult, attachmentsByMessageId, reactionsByMessageId] = await Promise.all([
            supabase
                .from('dm_messages')
                .select(`
                    *,
                    sender:users!sender_id (
                        id,
                        username,
                        avatar_url
                    )
                `)
                .in('id', pinnedMessageIds),
            getDmAttachmentMap(pinnedMessageIds),
            getDmReactionMap(pinnedMessageIds),
        ]);

        if (messageResult.error) {
            res.status(500).json({ error: messageResult.error.message });
            return;
        }

        const messagesMap = new Map<string, any>();
        ((messageResult.data || []) as Array<any>).forEach((message) => messagesMap.set(message.id, message));

        res.status(200).json({
            data: pinRows
                .map((pin) => {
                    const message = messagesMap.get(pin.dm_message_id || '');
                    if (!message) return null;
                    return buildPinnedMessagePayload(
                        message,
                        pin,
                        attachmentsByMessageId.get(pin.dm_message_id || '') || [],
                        reactionsByMessageId.get(pin.dm_message_id || '') || []
                    );
                })
                .filter((item): item is NonNullable<typeof item> => Boolean(item)),
        });
    } catch (error: any) {
        console.error('Error in getPinnedMessages:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

export const pinMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const { message_id, dm_message_id } = req.body as { message_id?: string; dm_message_id?: string };

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const targetResult = await resolvePinTarget(userId, message_id, dm_message_id);
        if ('error' in targetResult) {
            res.status(targetResult.status).json({ error: targetResult.error });
            return;
        }

        const target = targetResult;
        const { data: existingPin, error: existingError } = await (target.kind === 'channel'
            ? supabase.from('message_pins').select('id').eq('message_id', target.messageId).maybeSingle()
            : supabase.from('message_pins').select('id').eq('dm_message_id', target.messageId).maybeSingle());

        if (existingError && existingError.code !== 'PGRST116') {
            res.status(500).json({ error: existingError.message });
            return;
        }

        if (!existingPin) {
            const insertPayload = target.kind === 'channel'
                ? { message_id: target.messageId, dm_message_id: null, pinned_by: userId }
                : { message_id: null, dm_message_id: target.messageId, pinned_by: userId };

            const { error: insertError } = await supabase
                .from('message_pins')
                .insert(insertPayload);

            if (insertError) {
                res.status(500).json({ error: insertError.message });
                return;
            }
        }

        await emitPinUpdate(target, true);

        res.status(200).json({
            message: 'Message pinned successfully.',
            data: target.kind === 'channel'
                ? { message_id: target.messageId }
                : { dm_message_id: target.messageId },
        });
    } catch (error: any) {
        console.error('Error in pinMessage:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

export const unpinMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user?.sub;
        const { message_id, dm_message_id } = req.body as { message_id?: string; dm_message_id?: string };

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const targetResult = await resolvePinTarget(userId, message_id, dm_message_id);
        if ('error' in targetResult) {
            res.status(targetResult.status).json({ error: targetResult.error });
            return;
        }

        const target = targetResult;
        const deleteResult = await (target.kind === 'channel'
            ? supabase.from('message_pins').delete().eq('message_id', target.messageId).select('id').maybeSingle()
            : supabase.from('message_pins').delete().eq('dm_message_id', target.messageId).select('id').maybeSingle());

        if (deleteResult.error && deleteResult.error.code !== 'PGRST116') {
            res.status(500).json({ error: deleteResult.error.message });
            return;
        }

        if (!deleteResult.data) {
            res.status(404).json({ error: 'Pin not found.' });
            return;
        }

        await emitPinUpdate(target, false);

        res.status(200).json({
            message: 'Message unpinned successfully.',
            data: target.kind === 'channel'
                ? { message_id: target.messageId }
                : { dm_message_id: target.messageId },
        });
    } catch (error: any) {
        console.error('Error in unpinMessage:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

interface DmThread {
    id: string;
    user1_id: string;
    user2_id: string;
}

type DmThreadReadStatus = {
    thread_id: string;
    last_read_at: string;
};

type DmThreadUser = {
    id: string;
    username: string | null;
    avatar_url: string | null;
};

type DmMessageRecord = {
    id?: string;
    thread_id: string;
    sender_id: string;
    timestamp: string;
    media_url?: unknown;
    content?: string | null;
};

type DmThreadPreviewRecord = DmMessageRecord & {
    sender?: {
        id: string;
        username: string | null;
        avatar_url: string | null;
    } | null;
    attachments?: MessageAttachmentRecord[];
};

function dedupeThreadsByOtherUser(threads: DmThread[], userId: string): DmThread[] {
    const seenPairs = new Map<string, DmThread>();

    threads.forEach((thread) => {
        const otherUserId = thread.user1_id === userId ? thread.user2_id : thread.user1_id;
        if (!seenPairs.has(otherUserId)) {
            seenPairs.set(otherUserId, thread);
        }
    });

    return Array.from(seenPairs.values());
}

async function getUserDmThreads(userId: string): Promise<DmThread[]> {
    const { data: threads, error } = await supabase
        .from('dm_threads')
        .select('id, user1_id, user2_id')
        .or(`user1_id.eq."${userId}",user2_id.eq."${userId}"`);

    if (error) {
        throw error;
    }

    if (!threads?.length) {
        return [];
    }

    return dedupeThreadsByOtherUser(threads as DmThread[], userId);
}

async function getThreadReadStatusMap(userId: string, threadIds: string[]): Promise<Map<string, string>> {
    if (threadIds.length === 0) {
        return new Map();
    }

    const { data: readStatuses, error } = await supabase
        .from('thread_read_status')
        .select('thread_id, last_read_at')
        .eq('user_id', userId)
        .in('thread_id', threadIds);

    if (error && error.code !== 'PGRST116') {
        throw error;
    }

    const readStatusMap = new Map<string, string>();
    (readStatuses as DmThreadReadStatus[] | null)?.forEach((status) => {
        readStatusMap.set(status.thread_id, status.last_read_at);
    });

    return readStatusMap;
}

async function getThreadLatestMessage(threadId: string): Promise<DmMessageRecord | null> {
    const { data, error } = await supabase
        .from('dm_messages')
        .select('id, thread_id, sender_id, timestamp, media_url, content')
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return (data as DmMessageRecord | null) || null;
}

async function getThreadUnreadCount(threadId: string, userId: string, lastReadAt?: string): Promise<number> {
    let query = supabase
        .from('dm_messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .neq('sender_id', userId);

    if (lastReadAt) {
        query = query.gt('timestamp', lastReadAt);
    }

    const { count, error } = await query;

    if (error) {
        throw error;
    }

    return count || 0;
}

async function getThreadMessagesPage(threadId: string, pageSize: number): Promise<Array<DmMessageRecord & {
    sender?: {
        id: string;
        username: string | null;
        avatar_url: string | null;
    } | null;
    media_urls: string[];
    attachments: MessageAttachmentRecord[];
    username: string | null;
    sender_avatar_url: string | null;
}>> {
    const { data, error } = await supabase
        .from('dm_messages')
        .select(`
            *,
            sender:users!sender_id (
                id,
                username,
                avatar_url
            )
        `)
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false })
        .limit(pageSize);

    if (error) {
        throw error;
    }

    const messages = (data as DmThreadPreviewRecord[] | null) || [];
    const attachmentsByMessageId = await getDmAttachmentMap(
        messages
            .map((message) => message.id)
            .filter((id): id is string => typeof id === 'string')
    );

    return messages.map((message) => ({
        ...withMessageAttachments(message, attachmentsByMessageId.get(message.id || '') || []),
        username: message.sender?.username || null,
        sender_avatar_url: message.sender?.avatar_url || null,
    }));
}

export const getDmThreadMessages = async (req: Request, res: Response): Promise<any> => {
    try {
        const { threadId } = req.params;
        const offset = parseInt(req.query?.offset as string, 10) || 0;

        if (!threadId) {
            return res.status(400).json({ error: 'Thread ID is required.' });
        }

        const result = await dmService.getDmThreadMessages(threadId, offset);

        return res.status(200).json(result);
    } catch (err) {
        console.error('Unexpected error in getDmThreadMessages:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getDmMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const user_id = req.user?.sub;
        const rawOffset = req.query?.offset;
        const shouldPaginate = rawOffset !== undefined;
        const offset = Math.max(0, parseInt(rawOffset as string, 10) || 0);

        if (!user_id || typeof user_id !== 'string') {
            res.status(401).json({ error: 'Unauthorized user context.' });
            return;
        }

        const requestedUserId = req.params.userId;
        if (requestedUserId && requestedUserId !== user_id) {
            res.status(403).json({ error: 'User mismatch in request path.' });
            return;
        }

        const result = await dmService.getDmMessages(user_id, offset, shouldPaginate);

        res.status(200).json(result);
    } catch (err) {
        console.error('Error in getDmMessages:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Get unread message counts per thread
export const getUnreadCounts = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const user_id = authReq.user?.sub;

        if (!user_id || typeof user_id !== 'string') {
            res.status(401).json({ error: 'Unauthorized user context.' });
            return;
        }

        const requestedUserId = req.params.userId;
        if (requestedUserId && requestedUserId !== user_id) {
            res.status(403).json({ error: 'User mismatch in request path.' });
            return;
        }

        const result = await dmService.getUnreadCounts(user_id);

        res.status(200).json(result);
    } catch (err) {
        console.error('Error in getUnreadCounts:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Mark messages in a thread as read
export const markThreadAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const { threadId } = req.params;
        const userId = authReq.user?.sub;

        if (!threadId || !userId) {
            res.status(400).json({ error: 'Thread ID and authenticated user are required.' });
            return;
        }

        const result = await dmService.markThreadAsRead(threadId, userId);

        res.status(200).json(result);
    } catch (err) {
        console.error('Error in markThreadAsRead:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
