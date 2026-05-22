import { Request, Response } from "express";
import { v4 } from 'uuid';
import { supabase } from '../client/supabase';
import { parseMentions, processMentions, resolveMentions } from '../lib/mentionParser';
import { sendChannelPushNotification, sendDmPushNotification } from '../lib/pushNotificationService';
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { getUserSocket } from "../redis/userSocketStore";
import { getIO, userSocketMap } from "../sockets/chatSocket";
import { checkChannelSendPermission } from './channelController';

// --- Required for file uploads ---
// Make sure you have `multer` installed in your project.

// --- Type Definitions ---
type DmMessageBody = {
    content?: string;
    sender_id?: string;
    receiver_id: string;
    reply_to?: string;
};

type ChannelMessageBody = {
    content?: string;
    sender_id?: string;
    channel_id: string;
    reply_to?: string;
    file?: any;
};


// --- UTILITY FUNCTIONS ---
// These functions are good and will be kept as-is.
// --- MIME / Extension helpers ---
const IMAGE_MIME_SET = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'
]);

const KNOWN_FILE_MIME_EXT: Record<string, string> = {
    // Images
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
    // Text / docs
    'text/plain': 'txt', 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/json': 'json',
    // Archives (optional - comment out if not desired)
    'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
};

function extFromMime(mime: string): string | null {
    const knownExt = KNOWN_FILE_MIME_EXT[mime];
    if (knownExt) return knownExt;

    const subtype = mime.split('/')[1];
    if (!subtype) return null;

    const sanitizedSubtype = subtype
        .split(';')[0]
        .split('+')[0]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');

    return sanitizedSubtype || null;
}
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

function withMediaUrls<T extends { media_url?: unknown }>(message: T): T & { media_urls: string[] } {
    return {
        ...message,
        media_urls: normalizeMediaUrls(message.media_url),
    };
}

function getDmPreview(message?: { content?: unknown; media_urls?: unknown }): string {
    if (!message) return '';

    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;

    if (Array.isArray(message.media_urls) && message.media_urls.length > 0) {
        return '[Attachment]';
    }

    return '';
}


// --- CONTROLLERS ---

export const dmMessagePostController = async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    try {
        const body = req.body as DmMessageBody;
        const content = body?.content ?? '';
        const receiver_id = body.receiver_id as string;
        const reply_to = body?.reply_to ?? null;
        const sender_id = req.user?.sub;
        // Support both upload.single() (req.file) and upload.fields() (req.files)
        const anyReq = req as any;

        console.log("Starting dmMessagePostController");

        const uploadedFiles = getUploadedFiles(anyReq);
        if (uploadedFiles.length) {
            console.log('[DM Upload] Received files', {
                count: uploadedFiles.length,
                files: uploadedFiles.map((file) => ({
                    fieldname: file.fieldname,
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                })),
            });
        } else {
            console.log('[DM Upload] No file found on request');
        }

        // 1. Validate required fields and UUID format
        if (!sender_id) {
            return res.status(400).json({ error: "Invalid sender_id format." });
        }
        if (!receiver_id) {
            return res.status(400).json({ error: "Invalid receiver_id format." });
        }
        if (!content && uploadedFiles.length === 0) {
            return res.status(400).json({ error: "Message content or a file is required." });
        }

        // 2. Find or create DM thread
        const [user1_id, user2_id] =
            sender_id < receiver_id
                ? [sender_id, receiver_id]
                : [receiver_id, sender_id];

        let threadId: string;

        const { data, error } = await supabase
            .from('dm_threads')
            .insert({ user1_id, user2_id })
            .select('id')
            .maybeSingle();

        if (error && error.code === '23505') {
            // Thread already exists → fetch it
            const { data: existing } = await supabase
                .from('dm_threads')
                .select('id')
                .eq('user1_id', user1_id)
                .eq('user2_id', user2_id)
                .single();

            if (!existing) {
                return res.status(500).json({ error: 'Thread exists but could not be fetched.' });
            }

            threadId = existing.id;
        } else if (error) {
            console.error('Error creating DM thread:', error);
            return res.status(500).json({ error: 'Could not create DM thread.' });
        } else {
            threadId = data!.id;
        }


        // 3. Handle file upload
        const uploadedUrls: string[] = [];
        for (const uploadedFile of uploadedFiles) {
            let contentType: string | undefined = uploadedFile.mimetype;

            if (!contentType || contentType === 'application/octet-stream') {
                const sniff = sniffImageMime(uploadedFile.buffer);
                if (sniff) contentType = sniff.mime;
            }

            if (!contentType) contentType = 'application/octet-stream';

            const fileId = v4();
            const fileExt = extFromMime(contentType) || (uploadedFile.originalname?.split('.').pop()?.toLowerCase() || 'bin');
            const safeExt = fileExt.replace(/[^a-z0-9]/g, '');
            const fileName = `${fileId}.${safeExt}`;

            const { error: uploadError } = await supabase.storage
                .from('attachments')
                .upload(fileName, uploadedFile.buffer, { contentType });

            if (uploadError) {
                console.error('Error uploading file:', uploadError);
                return res.status(500).json({ error: 'Could not upload file.' });
            }

            const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(fileName);
            uploadedUrls.push(publicUrlData.publicUrl);
        }

        const media_url = serializeMediaUrls(uploadedUrls);


        // 4. Insert the message
        const newMessagePayload = {
            id: v4(),
            content: content || '',
            media_url,
            thread_id: threadId,
            sender_id,
            reply_to: reply_to || null,
        };

        const { data: savedMessage, error: insertError } = await supabase
            .from('dm_messages')
            .insert(newMessagePayload)
            .select()
            .single();

        if (insertError) {
            console.error("Error inserting DM:", insertError);
            return res.status(500).json({ error: 'Server error while saving message' });
        }

        // Fetch the full message with reply_to_message join for socket emit
        const { data: fullMessage, error: joinError } = await supabase
            .from('dm_messages')
            .select(`
            *,
            reply_to_message:reply_to (
              id, content, sender_id, users (username, avatar_url)
            )
          `)
            .eq('id', savedMessage.id)
            .single();
        if (joinError) {
            console.error('Error fetching joined message for socket:', joinError);
        }

        const io = getIO();
        // 5. Broadcast via Sockets (check local map, then Redis for cross-instance)
        const socketMessage = withMediaUrls(fullMessage || savedMessage);

        let receiverSocketId = userSocketMap.get(receiver_id) ?? await getUserSocket(receiver_id);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("receive_dm", socketMessage);
        }
        let senderSocketId = userSocketMap.get(sender_id) ?? await getUserSocket(sender_id);
        if (senderSocketId) {
            io.to(senderSocketId).emit("dm_confirmed", socketMessage);
        }

        // Fire-and-forget push for receiver (app may be backgrounded/offline).
        sendDmPushNotification(
            sender_id,
            receiver_id,
            getDmPreview(socketMessage),
            threadId
        ).catch(console.error);

        return res.status(200).json({ message: withMediaUrls(savedMessage) });
    } catch (e: any) {
        console.error("Error in dmMessagePostController:", e);
        return res.status(500).json({ msg: 'Server Error' });
    }
};


export const channelmessagePostController = async (req: AuthenticatedRequest, res: Response): Promise<any> => {
    try {
        const body = req.body as ChannelMessageBody;
        const sender_id = req.user?.sub || body.sender_id;
        const channel_id = body.channel_id as string;
        const content = body?.content ?? "";
        const reply_to = body.reply_to || null;

        const anyReqCh = req as any;
        const uploadedFiles = getUploadedFiles(anyReqCh);
        if (uploadedFiles.length) {
            console.log('[Channel Upload] Received files', {
                count: uploadedFiles.length,
                files: uploadedFiles.map((file) => ({
                    fieldname: file.fieldname,
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                })),
            });
        } else {
            console.log('[Channel Upload] No file found on request');
        }

        if (!sender_id) {
            return res.status(400).json({ error: "Invalid sender_id format." });
        }
        if (!channel_id) {
            return res.status(400).json({ error: "Invalid channel_id format." });
        }
        if (!content && uploadedFiles.length === 0) {
            return res.status(400).json({ error: "Message content or a file is required." });
        }

        // **NEW: Check channel send permissions**
        const permissionCheck = await checkChannelSendPermission(sender_id, channel_id);
        if (!permissionCheck.canSend) {
            return res.status(403).json({
                error: permissionCheck.error || 'You do not have permission to send messages in this channel'
            });
        }

        const uploadedUrls: string[] = [];
        const id = v4();

        for (const uploadedFile of uploadedFiles) {
            let contentType: string | undefined = uploadedFile.mimetype;
            if (!contentType || contentType === 'application/octet-stream') {
                const sniff = sniffImageMime(uploadedFile.buffer);
                if (sniff) contentType = sniff.mime;
            }
            if (!contentType) contentType = 'application/octet-stream';
            const fileExt = extFromMime(contentType) || uploadedFile.originalname?.split('.').pop()?.toLowerCase() || 'bin';
            const safeExt = fileExt.replace(/[^a-z0-9]/g, '');
            const fileName = `${v4()}.${safeExt}`;

            const { error: uploadError } = await supabase.storage
                .from('attachments')
                .upload(fileName, uploadedFile.buffer, {
                    contentType,
                    upsert: true,
                });
            if (uploadError) {
                console.error(uploadError);
                return res.status(500).json({ 'error': 'Server error during file upload' });
            }

            const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(fileName);
            uploadedUrls.push(publicUrlData.publicUrl);
        }

        const media_url = serializeMediaUrls(uploadedUrls);

        const { data: savedMessage, error: insertError } = await supabase
            .from("messages")
            .insert({
                id,
                channel_id,
                sender_id,
                content,
                media_url,
                reply_to // <-- ensure reply_to is stored
            })
            .select()
            .single();
        if (insertError) {
            console.error(insertError);
            return res.status(500).json({ error: 'Server error during message save' });
        }

        // Handle mentions if content exists
        if (content) {
            const parsedMentions = parseMentions(content);

            if (parsedMentions.mentions.length > 0) {
                // First resolve mentions (convert usernames to user IDs)
                const resolvedMentions = await resolveMentions(parsedMentions.mentions, channel_id);

                if (resolvedMentions.length > 0) {
                    // Then process mentions (store in DB and send notifications)
                    await processMentions(
                        id, // messageId
                        channel_id, // channelId
                        sender_id, // senderId
                        content, // content
                        resolvedMentions // resolved mentions array with user IDs
                    );
                }
            }
        }

        // Fetch the full message with sender and reply_to_message join for socket emit
        const { data: fullMessage, error: joinError } = await supabase
            .from('messages')
            .select(`
            *,
            sender:users!sender_id (
              id,
              username,
              avatar_url
            ),
            reply_to_message:reply_to (
              id, content, sender_id, users (username, avatar_url)
            )
          `)
            .eq('id', id)
            .single();
        if (joinError) {
            console.error('Error fetching joined message for socket:', joinError);
        }

        // Flatten sender info for frontend consistency
        const enrichedMessage = fullMessage ? {
            ...fullMessage,
            username: fullMessage.sender?.username || null,
            sender_avatar_url: fullMessage.sender?.avatar_url || null,
        } : savedMessage;

        const payloadMessage = withMediaUrls(enrichedMessage);

        const io = getIO();
        io.to(channel_id).emit("new_message", payloadMessage);

        // Fire-and-forget push for offline users.
        const channelPreview = (content || '').trim() || '[Attachment]';
        sendChannelPushNotification(sender_id, channel_id, channelPreview).catch(console.error);

        return res.status(200).json(payloadMessage);

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ error: 'Server error' });
    }
};

export const messageGetController = async (req: Request, res: Response): Promise<any> => {
    try {
        const channel_id = req.query?.channel_id as string;
        const offset = parseInt(req.query?.offset as string, 10) || 0;
        const pageSize = 15;

        if (!channel_id) {
            return res.status(400).json({ msg: 'Invalid channelId received' });
        }

        // OPTIMIZED: Single query with JOINs - no separate COUNT or user lookup queries
        const { data, error } = await supabase
            .from('messages')
            .select(`
            *,
            sender:users!sender_id (
              id,
              username,
              avatar_url
            ),
            reply_to_message:reply_to (
              id,
              content,
              sender_id,
              users (username, avatar_url)
            )
          `)
            .eq('channel_id', channel_id)
            .order('timestamp', { ascending: false })
            .range(offset, offset + pageSize); // Fetch pageSize + 1 to check hasMore

        if (error) {
            console.error('Error fetching messages:', error);
            return res.status(500).json({ msg: 'Server Error' });
        }

        // Determine hasMore by checking if we got more than pageSize results
        const hasMore = data ? data.length > pageSize : false;

        // Trim to actual page size
        const pageData = data ? data.slice(0, pageSize) : [];

        // Transform data to include username and avatar at top level
        const messagesWithUsernames = pageData.map((msg: any) => ({
            ...msg,
            username: msg.sender?.username || null,
            sender_avatar_url: msg.sender?.avatar_url || null,
            media_urls: normalizeMediaUrls(msg.media_url),
            // Keep sender object for compatibility but flatten the useful fields
        }));

        return res.status(200).json({
            data: messagesWithUsernames,
            hasMore
            // Removed totalCount - not needed for infinite scroll
        });
    }
    catch (e: any) {
        console.log(`Error in GET message : ${e}`);
        return res.status(500).json({ 'msg': 'Server Error' });
    }
}

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
        .select('thread_id, sender_id, timestamp, media_url, content')
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

    return ((data as DmThreadPreviewRecord[] | null) || []).map((message) => ({
        ...withMediaUrls(message),
        username: message.sender?.username || null,
        sender_avatar_url: message.sender?.avatar_url || null,
    }));
}

export const getDmThreadMessages = async (req: Request, res: Response): Promise<any> => {
    try {
        const { threadId } = req.params;
        const offset = parseInt(req.query?.offset as string, 10) || 0;
        const pageSize = 15;

        console.log("Starting getDmThreadMessages");

        if (!threadId) {
            return res.status(400).json({ error: 'Thread ID is required.' });
        }

        // OPTIMIZED: Single query with sender info, no separate COUNT query
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
            .range(offset, offset + pageSize); // Fetch pageSize + 1 to check hasMore

        if (error) {
            console.error('Error fetching DM thread messages:', error);
            return res.status(500).json({ error: 'Failed to fetch messages.' });
        }

        // Determine hasMore by checking if we got more than pageSize results
        const hasMore = data ? data.length > pageSize : false;

        // Trim to actual page size and flatten sender info
        const pageData = (data || []).slice(0, pageSize).map((msg: any) => ({
            ...msg,
            username: msg.sender?.username || null,
            sender_avatar_url: msg.sender?.avatar_url || null,
            media_urls: normalizeMediaUrls(msg.media_url),
        }));

        return res.status(200).json({
            data: pageData,
            hasMore
        });
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
        const pageSize = 15;

        if (!user_id || typeof user_id !== 'string') {
            res.status(401).json({ error: 'Unauthorized user context.' });
            return;
        }

        const requestedUserId = req.params.userId;
        if (requestedUserId && requestedUserId !== user_id) {
            res.status(403).json({ error: 'User mismatch in request path.' });
            return;
        }

        const userThreads = await getUserDmThreads(user_id);
        if (userThreads.length === 0) {
            res.status(200).json({ threads: [] });
            return;
        }

        const threadIds = userThreads.map((thread) => thread.id);
        const otherUserIds = userThreads.map((thread) =>
            thread.user1_id === user_id ? thread.user2_id : thread.user1_id
        );

        const [usersResult, readStatusMap] = await Promise.all([
            supabase
                .from('users')
                .select('id, username, avatar_url')
                .in('id', otherUserIds),
            getThreadReadStatusMap(user_id, threadIds),
        ]);

        if (usersResult.error) {
            throw usersResult.error;
        }

        const usersMap = new Map<string, DmThreadUser>();
        (usersResult.data as DmThreadUser[] | null)?.forEach((user) => usersMap.set(user.id, user));

        const threadSummaries = await Promise.all(
            userThreads.map(async (thread) => {
                const lastReadAt = readStatusMap.get(thread.id);
                const [latestMessage, unreadCount] = await Promise.all([
                    getThreadLatestMessage(thread.id),
                    getThreadUnreadCount(thread.id, user_id, lastReadAt),
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
        const paginatedMessages = await Promise.all(
            paginatedSummaries.map(async ({ thread }) => ({
                threadId: thread.id,
                messages: await getThreadMessagesPage(thread.id, pageSize),
            }))
        );
        const messagesByThread = new Map(
            paginatedMessages.map(({ threadId, messages }) => [threadId, messages])
        );

        const groupedThreads = paginatedSummaries.map(({ thread, latestMessage, unreadCount }) => {
            const otherUserId =
                thread.user1_id === user_id ? thread.user2_id : thread.user1_id;
            const otherUser = usersMap.get(otherUserId) || null;
            const msgs = messagesByThread.get(thread.id) || [];
            const latestTimestamp =
                latestMessage?.timestamp || new Date(0).toISOString();
            const latestMessagePreview = getDmPreview(
                latestMessage ? withMediaUrls(latestMessage) : undefined
            );

            return {
                thread_id: thread.id,
                messages: msgs,
                other_user: otherUser,
                unread_count: unreadCount,
                recipient_id: otherUserId,
                latest_message_timestamp: latestTimestamp,
                latest_message_preview: latestMessagePreview
            };
        });

        const hasMore = shouldPaginate && offset + pageSize < threadSummaries.length;

        res.status(200).json({
            threads: groupedThreads,
            hasMore,
        });
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

        const threads = await getUserDmThreads(user_id);
        if (threads.length === 0) {
            res.status(200).json({ unreadCounts: {}, totalUnread: 0 });
            return;
        }

        const threadIds = threads.map((thread) => thread.id);
        const readStatusMap = await getThreadReadStatusMap(user_id, threadIds);

        const unreadEntries = await Promise.all(
            threadIds.map(async (threadId) => {
                const unreadCount = await getThreadUnreadCount(
                    threadId,
                    user_id,
                    readStatusMap.get(threadId)
                );

                return [threadId, unreadCount] as const;
            })
        );

        const unreadCounts = Object.fromEntries(unreadEntries);
        let totalUnread = 0;

        threadIds.forEach((threadId) => {
            totalUnread += unreadCounts[threadId] || 0;
        });

        res.status(200).json({
            unreadCounts,
            totalUnread
        });
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

        // Get the latest message timestamp in this thread
        const { data: latestMessage, error: msgError } = await supabase
            .from('dm_messages')
            .select('timestamp')
            .eq('thread_id', threadId)
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();

        if (msgError && msgError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
            console.error('Error fetching latest message:', msgError);
        }

        const lastReadAt = latestMessage?.timestamp || new Date().toISOString();

        // Upsert the last_read_at timestamp for this thread and user
        // This uses a thread_read_status table (need to create if doesn't exist)
        const { error: upsertError } = await supabase
            .from('thread_read_status')
            .upsert(
                {
                    thread_id: threadId,
                    user_id: userId,
                    last_read_at: lastReadAt,
                    updated_at: new Date().toISOString()
                },
                {
                    onConflict: 'thread_id,user_id'
                }
            );

        if (upsertError) {
            // If table doesn't exist, log it but don't fail
            console.error('Error upserting thread read status:', upsertError);
            // For now, return success anyway to not break the UI
            res.status(200).json({ success: true, message: 'Read tracking table not yet created' });
            return;
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Error in markThreadAsRead:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
