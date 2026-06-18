import { v4 } from 'uuid';
import { getUserSocket } from '../redis/userSocketStore';
import { getIO, userSocketMap } from '../sockets/chatSocket';
import { sendDmPushNotification } from '../notifications/pushNotificationService';
import { MessageAttachmentRecord, MediaItem } from '../types/attachment.types';
import { MessageReactionSummary } from '../types/reaction.types';
import * as attachmentRepository from '../repositories/attachmentRepository';
import * as reactionRepository from '../repositories/reactionRepository';
import * as dmRepository from '../repositories/dmRepository';
import { getAttachmentPreview, normalizeMediaUrls, resolveGifMediaUrl } from '../utils/message';
import { uploadMessageAttachments } from './messageService';

type UploadedFile = {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
    size: number;
};

function statusError(message: string, status: number): Error & { status?: number } {
    return Object.assign(new Error(message), { status });
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

function resolveGifMessageMedia(content: unknown, mediaUrl: string | null): { content: string; mediaUrl: string | null } {
    const gifMediaUrl = resolveGifMediaUrl(content);

    return {
        content: gifMediaUrl ? '' : (typeof content === 'string' ? content : ''),
        mediaUrl: mediaUrl || gifMediaUrl,
    };
}

function getDmPreview(message?: { content?: unknown; attachments?: MessageAttachmentRecord[]; media_urls?: unknown }): string {
    if (!message) return '';

    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;

    return getAttachmentPreview(message);
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

function dedupeThreadsByOtherUser(threads: dmRepository.DmThread[], userId: string): dmRepository.DmThread[] {
    const seenPairs = new Map<string, dmRepository.DmThread>();

    threads.forEach((thread) => {
        const otherUserId = thread.user1_id === userId ? thread.user2_id : thread.user1_id;
        if (!seenPairs.has(otherUserId)) {
            seenPairs.set(otherUserId, thread);
        }
    });

    return Array.from(seenPairs.values());
}

async function getAccessibleThread(userId: string, threadId: string): Promise<dmRepository.DmThread> {
    const thread = await dmRepository.fetchDmThread(threadId);

    if (!thread || (thread.user1_id !== userId && thread.user2_id !== userId)) {
        throw statusError('You do not have access to this DM thread.', 403);
    }

    return thread;
}

async function getOrCreateThread(senderId: string, receiverId: string): Promise<dmRepository.DmThread> {
    const [user1Id, user2Id] = senderId < receiverId
        ? [senderId, receiverId]
        : [receiverId, senderId];

    try {
        return await dmRepository.createDmThread(user1Id, user2Id);
    } catch (error: any) {
        if (error?.code !== '23505') {
            throw error;
        }

        const existing = await dmRepository.findDmThread(user1Id, user2Id);
        if (!existing) {
            throw statusError('Thread exists but could not be fetched.', 500);
        }

        return existing;
    }
}

async function getThreadReadStatusMap(userId: string, threadIds: string[]): Promise<Map<string, string>> {
    const readStatusMap = new Map<string, string>();
    const readStatuses = await dmRepository.fetchThreadReadStatuses(userId, threadIds);

    readStatuses.forEach((status) => {
        readStatusMap.set(status.thread_id, status.last_read_at);
    });

    return readStatusMap;
}

async function getThreadMessagesPage(threadId: string, pageSize: number) {
    const messages = await dmRepository.fetchThreadMessagesPage(threadId, pageSize);
    const attachmentsByMessageId = await attachmentRepository.fetchDmAttachmentMap(
        messages.map((message: any) => message.id).filter((id: unknown): id is string => typeof id === 'string')
    );

    return messages.map((message: any) => ({
        ...withMessageAttachments(message, attachmentsByMessageId.get(message.id || '') || []),
        username: message.sender?.username || null,
        sender_avatar_url: message.sender?.avatar_url || null,
    }));
}

export async function sendDmMessage(input: {
    senderId: string;
    receiverId: string;
    content: string;
    replyTo?: string | null;
    durationMs: number | null;
    files: UploadedFile[];
}) {
    const { senderId, receiverId, content, replyTo = null, durationMs, files } = input;
    const thread = await getOrCreateThread(senderId, receiverId);
    const resolvedMessage = resolveGifMessageMedia(content, null);
    const uploadResult = files.length > 0 ? await uploadMessageAttachments(files, durationMs) : { attachments: [], mediaUrl: null };
    const mediaUrl = uploadResult.mediaUrl || resolvedMessage.mediaUrl;
    const messageId = v4();

    const savedMessage = await dmRepository.insertDmMessage({
        id: messageId,
        content: resolvedMessage.content,
        media_url: mediaUrl,
        thread_id: thread.id,
        sender_id: senderId,
        reply_to: replyTo,
    });

    const persistedAttachments = await attachmentRepository.insertDmMessageAttachments(messageId, uploadResult.attachments);
    const fullMessage = await dmRepository.fetchDmMessageById(messageId).catch(() => null);
    const socketMessage = withMessageAttachments(fullMessage || savedMessage, persistedAttachments);
    const io = getIO();

    const receiverSocketId = userSocketMap.get(receiverId) ?? await getUserSocket(receiverId);
    if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_dm', socketMessage);
    }

    const senderSocketId = userSocketMap.get(senderId) ?? await getUserSocket(senderId);
    if (senderSocketId) {
        io.to(senderSocketId).emit('dm_confirmed', socketMessage);
    }

    sendDmPushNotification(senderId, receiverId, getDmPreview(socketMessage), thread.id).catch(console.error);

    return {
        message: withMessageAttachments(savedMessage, persistedAttachments),
    };
}

export async function searchDmMessages(userId: string, threadId: string, query: string): Promise<{ data: any[] }> {
    await getAccessibleThread(userId, threadId);

    const results = await dmRepository.searchDmMessages(threadId, query, 50);
    const messageIds = results.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
    const [attachmentsByMessageId, reactionsByMessageId] = await Promise.all([
        attachmentRepository.fetchDmAttachmentMap(messageIds),
        reactionRepository.fetchDmReactionMap(messageIds),
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

export async function getDmMedia(userId: string, threadId: string): Promise<{ data: MediaItem[] }> {
    await getAccessibleThread(userId, threadId);

    const messages = await dmRepository.fetchDmMediaMessages(threadId);
    const messageIds = messages.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
    const attachmentsByMessageId = await attachmentRepository.fetchDmAttachmentMap(messageIds);

    return {
        data: buildMediaItems(messages, attachmentsByMessageId),
    };
}

export async function getDmThreadMessages(threadId: string, offset: number): Promise<{ data: any[]; hasMore: boolean }> {
    const pageSize = 15;
    const data = await dmRepository.fetchDmThreadMessages(threadId, offset, pageSize);
    const hasMore = data.length > pageSize;
    const pageData = data.slice(0, pageSize);
    const messageIds = pageData.map((msg: any) => msg.id).filter((id: unknown): id is string => typeof id === 'string');
    const [attachmentsByMessageId, reactionsByMessageId] = await Promise.all([
        attachmentRepository.fetchDmAttachmentMap(messageIds),
        reactionRepository.fetchDmReactionMap(messageIds),
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

export async function getDmMessages(userId: string, offset: number, shouldPaginate: boolean) {
    const pageSize = 15;
    const userThreads = dedupeThreadsByOtherUser(await dmRepository.fetchUserDmThreads(userId), userId);

    if (userThreads.length === 0) {
        return { threads: [] };
    }

    const threadIds = userThreads.map((thread) => thread.id);
    const otherUserIds = userThreads.map((thread) =>
        thread.user1_id === userId ? thread.user2_id : thread.user1_id
    );

    const [users, readStatusMap] = await Promise.all([
        dmRepository.fetchUsersByIds(otherUserIds),
        getThreadReadStatusMap(userId, threadIds),
    ]);

    const usersMap = new Map<string, dmRepository.DmThreadUser>();
    users.forEach((user) => usersMap.set(user.id, user));

    const threadSummaries = await Promise.all(
        userThreads.map(async (thread) => {
            const lastReadAt = readStatusMap.get(thread.id);
            const [latestMessage, unreadCount] = await Promise.all([
                dmRepository.fetchThreadLatestMessage(thread.id),
                dmRepository.fetchThreadUnreadCount(thread.id, userId, lastReadAt),
            ]);

            return {
                thread,
                latestMessage,
                unreadCount,
            };
        })
    );

    threadSummaries.sort(
        (a, b) =>
            new Date(b.latestMessage?.timestamp || 0).getTime() -
            new Date(a.latestMessage?.timestamp || 0).getTime()
    );

    const paginatedSummaries = shouldPaginate
        ? threadSummaries.slice(offset, offset + pageSize)
        : threadSummaries;
    const latestAttachmentsByMessageId = await attachmentRepository.fetchDmAttachmentMap(
        paginatedSummaries
            .map(({ latestMessage }) => latestMessage?.id)
            .filter((id): id is string => typeof id === 'string')
    );

    const includeThreadMessages = !shouldPaginate;
    const threadMessagesByThreadId = includeThreadMessages
        ? new Map<string, { messages: Array<any>; hasMore: boolean }>()
        : null;

    if (includeThreadMessages) {
        await Promise.all(
            paginatedSummaries.map(async ({ thread }) => {
                const latestMessages = await getThreadMessagesPage(thread.id, pageSize + 1);
                threadMessagesByThreadId?.set(thread.id, {
                    messages: latestMessages.slice(0, pageSize).reverse(),
                    hasMore: latestMessages.length > pageSize,
                });
            })
        );
    }

    const groupedThreads = paginatedSummaries.map(({ thread, latestMessage, unreadCount }) => {
        const otherUserId = thread.user1_id === userId ? thread.user2_id : thread.user1_id;
        const otherUser = usersMap.get(otherUserId) || null;
        const latestTimestamp = latestMessage?.timestamp || new Date(0).toISOString();
        const latestMessagePreview = getDmPreview(
            latestMessage
                ? withMessageAttachments(
                    latestMessage,
                    latestAttachmentsByMessageId.get(latestMessage.id || '') || []
                )
                : undefined
        );
        const threadMessages = threadMessagesByThreadId?.get(thread.id);

        return {
            thread_id: thread.id,
            other_user: otherUser,
            unread_count: unreadCount,
            recipient_id: otherUserId,
            latest_message_timestamp: latestTimestamp,
            latest_message_preview: latestMessagePreview,
            messages: threadMessages?.messages ?? undefined,
            has_more_messages: threadMessages?.hasMore ?? undefined,
        };
    });

    return {
        threads: groupedThreads,
        hasMore: shouldPaginate && offset + pageSize < threadSummaries.length,
    };
}

export async function getUnreadCounts(userId: string): Promise<{ unreadCounts: Record<string, number>; totalUnread: number }> {
    const threads = dedupeThreadsByOtherUser(await dmRepository.fetchUserDmThreads(userId), userId);

    if (threads.length === 0) {
        return { unreadCounts: {}, totalUnread: 0 };
    }

    const threadIds = threads.map((thread) => thread.id);
    const readStatusMap = await getThreadReadStatusMap(userId, threadIds);
    const unreadEntries = await Promise.all(
        threadIds.map(async (threadId) => {
            const unreadCount = await dmRepository.fetchThreadUnreadCount(threadId, userId, readStatusMap.get(threadId));
            return [threadId, unreadCount] as const;
        })
    );

    const unreadCounts = Object.fromEntries(unreadEntries);
    const totalUnread = threadIds.reduce((total, threadId) => total + (unreadCounts[threadId] || 0), 0);

    return {
        unreadCounts,
        totalUnread,
    };
}

export async function markThreadAsRead(threadId: string, userId: string): Promise<{ success: true; message?: string }> {
    const lastReadAt = await dmRepository.fetchLatestThreadMessageTimestamp(threadId) || new Date().toISOString();

    try {
        await dmRepository.upsertThreadReadStatus(threadId, userId, lastReadAt);
    } catch (error) {
        console.error('Error upserting thread read status:', error);
        return { success: true, message: 'Read tracking table not yet created' };
    }

    return { success: true };
}
