import { v4 } from 'uuid';
import { checkChannelAccess, checkChannelSendPermission } from '../controllers/channelController';
import { checkMembershipOrOwnership } from '../controllers/roleController';
import { getIO } from '../sockets/chatSocket';
import { sendChannelPushNotification } from '../notifications/pushNotificationService';
import { parseMentions, processMentions, resolveMentions } from '../lib/mentionParser';
import { MessageAttachmentRecord, UploadedAttachment, MediaItem } from '../types/attachment.types';
import { MessageReactionSummary } from '../types/reaction.types';
import * as messageRepository from '../repositories/messageRepository';
import * as attachmentRepository from '../repositories/attachmentRepository';
import * as reactionRepository from '../repositories/reactionRepository';
import {
    classifyAttachmentType,
    extFromMime,
    normalizeMediaUrls,
    resolveGifMediaUrl,
    serializeMediaUrls,
    sniffImageMime,
    getAttachmentPreview,
} from '../utils/message';

type UploadedFile = {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
    size: number;
};

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

function resolveGifMessageMedia(content: unknown, mediaUrl: string | null): { content: string; mediaUrl: string | null } {
    const gifMediaUrl = resolveGifMediaUrl(content);

    return {
        content: gifMediaUrl ? '' : (typeof content === 'string' ? content : ''),
        mediaUrl: mediaUrl || gifMediaUrl,
    };
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

async function getAccessibleServerChannelIds(userId: string, serverId: string): Promise<string[]> {
    const hasServerAccess = await checkMembershipOrOwnership(userId, serverId);
    if (!hasServerAccess) {
        return [];
    }

    const channelRows = (await messageRepository.fetchServerChannelIds(serverId)).map((id) => ({ id }));
    if (channelRows.length === 0) {
        return [];
    }

    const checks = await Promise.all(
        channelRows.map(async (channel) => ({
            id: channel.id,
            canAccess: await checkChannelAccess(userId, channel.id),
        }))
    );

    return checks.filter((channel) => channel.canAccess).map((channel) => channel.id);
}

export async function uploadMessageAttachments(
    uploadedFiles: UploadedFile[],
    fallbackDurationMs: number | null
) {
    const attachments: UploadedAttachment[] = [];
    const uploadedUrls: string[] = [];

    for (const uploadedFile of uploadedFiles) {
        let contentType = uploadedFile.mimetype;

        if (!contentType || contentType === 'application/octet-stream') {
            const sniff = sniffImageMime(uploadedFile.buffer);
            if (sniff) {
                contentType = sniff.mime;
            }
        }

        contentType ??= 'application/octet-stream';

        const fileId = v4();
        const fileExt = extFromMime(contentType) || uploadedFile.originalname?.split('.').pop()?.toLowerCase() || 'bin';
        const storagePath = `${fileId}.${fileExt}`;
        const publicUrl = await attachmentRepository.uploadAttachment(storagePath, uploadedFile.buffer, contentType);
        const attachmentType = classifyAttachmentType(contentType, uploadedFile.originalname);

        uploadedUrls.push(publicUrl);
        attachments.push({
            url: publicUrl,
            storage_path: storagePath,
            mime_type: contentType,
            attachment_type: attachmentType,
            file_name: uploadedFile.originalname || storagePath,
            file_size: uploadedFile.size,
            duration_ms: attachmentType === 'audio' ? fallbackDurationMs : null,
        });
    }

    return {
        attachments,
        mediaUrl: serializeMediaUrls(uploadedUrls),
    };
}

export async function getMessages(channelId: string, offset: number): Promise<{ data: any[]; hasMore: boolean }> {
    const pageSize = 15;
    const data = await messageRepository.fetchChannelMessages(channelId, offset, pageSize);
    const hasMore = data ? data.length > pageSize : false;
    const pageData = data ? data.slice(0, pageSize) : [];

    const messageIds = pageData.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
    const [attachmentsByMessageId, reactionsByMessageId] = await Promise.all([
        attachmentRepository.fetchChannelAttachmentMap(messageIds),
        reactionRepository.fetchChannelReactionMap(messageIds),
    ]);

    return {
        data: pageData.map((msg: any) => ({
            ...withMessageAttachments(msg, attachmentsByMessageId.get(msg.id) || []),
            ...withMessageReactions(msg, reactionsByMessageId.get(msg.id) || []),
            username: msg.sender?.username || null,
            sender_avatar_url: msg.sender?.avatar_url || null,
        })),
        hasMore,
    };
}

export const getChannelMessages = getMessages;

export async function searchChannelMessages(userId: string, serverId: string, query: string): Promise<{ data: any[] }> {
    const channelIds = await getAccessibleServerChannelIds(userId, serverId);
    if (channelIds.length === 0) {
        return { data: [] };
    }

    const results = await messageRepository.searchChannelMessages(channelIds, query, 50);
    const messageIds = results.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
    const [attachmentsByMessageId, reactionsByMessageId] = await Promise.all([
        attachmentRepository.fetchChannelAttachmentMap(messageIds),
        reactionRepository.fetchChannelReactionMap(messageIds),
    ]);

    return {
        data: results.map((msg: any) => ({
            ...withMessageAttachments(msg, attachmentsByMessageId.get(msg.id) || []),
            ...withMessageReactions(msg, reactionsByMessageId.get(msg.id) || []),
            username: msg.sender?.username || null,
            sender_avatar_url: msg.sender?.avatar_url || null,
        })),
    };
}

export async function getChannelMedia(userId: string, serverId: string): Promise<{ data: MediaItem[] }> {
    const channelIds = await getAccessibleServerChannelIds(userId, serverId);
    if (channelIds.length === 0) {
        return { data: [] };
    }

    const messages = await messageRepository.fetchChannelMedia(channelIds);
    const messageIds = messages.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
    const attachmentsByMessageId = await attachmentRepository.fetchChannelAttachmentMap(messageIds);

    return {
        data: buildMediaItems(messages, attachmentsByMessageId),
    };
}

export async function sendChannelMessage(input: {
    senderId: string;
    channelId: string;
    content: string;
    replyTo?: string | null;
    durationMs: number | null;
    files: UploadedFile[];
}) {
    const { senderId, channelId, content, replyTo = null, durationMs, files } = input;
    const permissionCheck = await checkChannelSendPermission(senderId, channelId);

    if (!permissionCheck.canSend) {
        throw new Error(permissionCheck.error || 'You do not have permission to send messages in this channel');
    }

    const resolvedMessage = resolveGifMessageMedia(content, null);
    const uploadResult = files.length > 0 ? await uploadMessageAttachments(files, durationMs) : { attachments: [], mediaUrl: null };
    const mediaUrl = uploadResult.mediaUrl || resolvedMessage.mediaUrl;
    const messageId = v4();

    await messageRepository.insertChannelMessage({
        id: messageId,
        channel_id: channelId,
        sender_id: senderId,
        content: resolvedMessage.content,
        media_url: mediaUrl,
        reply_to: replyTo,
    });

    const persistedAttachments = await attachmentRepository.insertChannelMessageAttachments(messageId, uploadResult.attachments);
    const savedMessage = await messageRepository.fetchChannelMessageById(messageId);

    if (resolvedMessage.content) {
        const parsedMentions = parseMentions(resolvedMessage.content);

        if (parsedMentions.mentions.length > 0) {
            const resolvedMentions = await resolveMentions(parsedMentions.mentions, channelId);

            if (resolvedMentions.length > 0) {
                await processMentions(messageId, channelId, senderId, resolvedMessage.content, resolvedMentions);
            }
        }
    }

    const baseMessage = savedMessage
        ? savedMessage
        : { id: messageId, channel_id: channelId, sender_id: senderId, content: resolvedMessage.content, media_url: mediaUrl, reply_to: replyTo };

    const payloadMessage = {
        ...withMessageAttachments(baseMessage, persistedAttachments),
        username: (savedMessage as any)?.sender?.username || null,
        sender_avatar_url: (savedMessage as any)?.sender?.avatar_url || null,
    };

    const io = getIO();
    io.to(channelId).emit('new_message', payloadMessage);

    const channelPreview = (content || '').trim() || getAttachmentPreview(payloadMessage) || '[Attachment]';
    sendChannelPushNotification(senderId, channelId, channelPreview).catch(console.error);

    return payloadMessage;
}

export async function getChannelMessageContext(messageId: string){
    const result = await messageRepository.fetchChannelwithSender(messageId);

    if(!result?.channelId || !result.senderId ){
        throw new Error("result not found, senderId or ChannelId was not found");
    }

    return result;
}