import { Request, Response } from "express";
import { supabase } from '../client/supabase';
import { v4 } from 'uuid';
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { getIO, userSocketMap } from "../sockets/chatSocket";
import { getUserSocket } from "../redis/userSocketStore";
import { parseMentions, resolveMentions, processMentions } from '../lib/mentionParser';
import { checkChannelSendPermission } from './channelController';

// --- Required for file uploads ---
// Make sure you have `multer` installed in your project.
import multer from 'multer';

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
    'image/jpeg','image/png','image/gif','image/webp','image/bmp','image/svg+xml'
]);

const ALLOWED_FILE_MIME: Record<string,string> = {
    // Images
    'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','image/bmp':'bmp','image/svg+xml':'svg',
    // Text / docs
    'text/plain':'txt','application/pdf':'pdf','application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
    'application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
    'application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
    'application/json':'json',
    // Archives (optional - comment out if not desired)
    'application/zip':'zip','application/x-zip-compressed':'zip',
};

function extFromMime(mime: string): string | null {
    return ALLOWED_FILE_MIME[mime] || null;
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

        let uploadedFile = anyReq.file as Express.Multer.File | undefined;
        if (!uploadedFile && anyReq.files) {
            // Multer fields style: { image?: [File], file?: [File] }
            const filesObj = anyReq.files as Record<string, Express.Multer.File[]>;
            if (filesObj.image && filesObj.image.length) uploadedFile = filesObj.image[0];
            else if (filesObj.file && filesObj.file.length) uploadedFile = filesObj.file[0];
        }
        if (uploadedFile) {
            console.log('[DM Upload] Received file', {
                fieldname: uploadedFile.fieldname,
                originalname: uploadedFile.originalname,
                mimetype: uploadedFile.mimetype,
                size: uploadedFile.size
            });
        } else {
            console.log('[DM Upload] No file found on request');
        }

        // 1. Validate required fields and UUID format
        if (!sender_id ) {
            return res.status(400).json({ error: "Invalid sender_id format." });
        }
        if (!receiver_id) {
            return res.status(400).json({ error: "Invalid receiver_id format." });
        }
        if (!content && !uploadedFile) {
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
            return res.status(500).json({error: 'Thread exists but could not be fetched.'});
        }

        threadId = existing.id;
        } else if (error) {
        console.error('Error creating DM thread:', error);
        return res.status(500).json({ error: 'Could not create DM thread.' });
        } else {
        threadId = data!.id;
        }


        // 3. Handle file upload
        let media_url: string | null = null;
        if (uploadedFile) {
            let contentType: string | undefined = uploadedFile.mimetype;

            // Some environments may give empty or generic types; attempt sniff only if likely image
            if (!contentType || contentType === 'application/octet-stream') {
                const sniff = sniffImageMime(uploadedFile.buffer);
                if (sniff) contentType = sniff.mime; // sniff only handles images
            }

            if (!contentType) {
                return res.status(400).json({ msg: 'Could not determine file MIME type.' });
            }

            if (!extFromMime(contentType)) {
                return res.status(415).json({ msg: 'Unsupported file type.' });
            }

            
            const fileId = v4();
            const fileExt = extFromMime(contentType) || (uploadedFile.originalname?.split('.').pop()?.toLowerCase() || 'bin');
            const safeExt = fileExt.replace(/[^a-z0-9]/g,'');
            const fileName = `${fileId}.${safeExt}`;

            const { error: uploadError } = await supabase.storage
                .from('attachments')
                .upload(fileName, uploadedFile.buffer, { contentType });

            if (uploadError) {
                console.error('Error uploading file:', uploadError);
                return res.status(500).json({ error: 'Could not upload file.' });
            }
            const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(fileName);
            media_url = publicUrlData.publicUrl;
        
        }
        

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
        io.to(savedMessage.channel_id).emit("new_message", fullMessage || savedMessage);
        // 5. Broadcast via Sockets (check local map, then Redis for cross-instance)
        let receiverSocketId = userSocketMap.get(receiver_id) ?? await getUserSocket(receiver_id);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("receive_dm", savedMessage);
        }
        let senderSocketId = userSocketMap.get(sender_id) ?? await getUserSocket(sender_id);
        if (senderSocketId) {
            io.to(senderSocketId).emit("dm_confirmed", fullMessage || savedMessage);
        }

        return res.status(200).json({ message: savedMessage });
    } catch (e: any) {
        console.error("Error in dmMessagePostController:", e);
        return res.status(500).json({ msg: 'Server Error' });
    }
};


export const channelmessagePostController = async (req:AuthenticatedRequest, res:Response):Promise<any> => {
    try {
        const body = req.body as ChannelMessageBody;
        const sender_id = req.user?.sub || body.sender_id;
        const channel_id = body.channel_id as string;
        const content = body?.content ?? "";
        const reply_to = body.reply_to || null;
        
        const anyReqCh = req as any;
        let uploadedFile = anyReqCh.file as Express.Multer.File | undefined;
        if (!uploadedFile && anyReqCh.files) {
            const filesObj = anyReqCh.files as Record<string, Express.Multer.File[]>;
            if (filesObj.image && filesObj.image.length) uploadedFile = filesObj.image[0];
            else if (filesObj.file && filesObj.file.length) uploadedFile = filesObj.file[0];
        }
        if (uploadedFile) {
            console.log('[Channel Upload] Received file', {
                fieldname: uploadedFile.fieldname,
                originalname: uploadedFile.originalname,
                mimetype: uploadedFile.mimetype,
                size: uploadedFile.size
            });
        } else {
            console.log('[Channel Upload] No file found on request');
        }

        if (!sender_id ) {
            return res.status(400).json({ error: "Invalid sender_id format." });
        }
        if (!channel_id ) {
            return res.status(400).json({ error: "Invalid channel_id format." });
        }
        if (!content && !uploadedFile) {
            return res.status(400).json({ error: "Message content or a file is required." });
        }

        // **NEW: Check channel send permissions**
        const permissionCheck = await checkChannelSendPermission(sender_id, channel_id);
        if (!permissionCheck.canSend) {
            return res.status(403).json({ 
                error: permissionCheck.error || 'You do not have permission to send messages in this channel' 
            });
        }

        let media_url:string | null = null;
        const id = v4();

        if (uploadedFile) {
            let contentType: string | undefined = uploadedFile.mimetype;
            if (!contentType || contentType === 'application/octet-stream') {
                const sniff = sniffImageMime(uploadedFile.buffer);
                if (sniff) contentType = sniff.mime;
            }
            if (!contentType) {
                return res.status(400).json({ msg: 'Could not determine file MIME type.' });
            }
            if (!extFromMime(contentType)) {
                return res.status(415).json({ msg: 'Unsupported file type.' });
            }
            const fileExt = extFromMime(contentType) || uploadedFile.originalname.split('.').pop() || 'bin';
            const safeExt = fileExt.replace(/[^a-z0-9]/g,'');
            const fileName = `${id}.${safeExt}`;

            const { error: uploadError } = await supabase.storage
                .from('attachments')
                .upload(fileName, uploadedFile.buffer, {
                    contentType,
                    upsert: true,
                });
            if (uploadError) {
                console.error(uploadError);
                return res.status(500).json({'error':'Server error during file upload'});
            }

            const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(fileName);
            media_url = publicUrlData.publicUrl;
        }

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
        if(insertError){
            console.error(insertError);
            return res.status(500).json({error:'Server error during message save'});
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

        const io = getIO();
        io.to(channel_id).emit("new_message", enrichedMessage);
        
        return res.status(200).json(enrichedMessage);

    } catch(error:any) {
        console.error(error);
        return res.status(500).json({error:'Server error'});
    }
};

export const messageGetController = async (req:Request, res:Response):Promise<any>=>{
    try{
        const channel_id  = req.query?.channel_id as string;
        const offset = parseInt(req.query?.offset as string, 10) || 0;
        const pageSize = 15;

        if(!channel_id ){
            return res.status(400).json({msg:'Invalid channelId received'});
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

        if(error){
            console.error('Error fetching messages:', error);
            return res.status(500).json({msg:'Server Error'});
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
            // Keep sender object for compatibility but flatten the useful fields
        }));

        return res.status(200).json({
            data: messagesWithUsernames,
            hasMore
            // Removed totalCount - not needed for infinite scroll
        });
    }
    catch(e:any){
        console.log(`Error in GET message : ${e}`);
        return res.status(500).json({'msg':'Server Error'});
    }
}

interface DmThread {
    id: string;
    user1_id:string;
    user2_id:string;
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
        const user_id = req.params.userId
        const offset = parseInt(req.query?.offset as string, 10) || 0
        const pageSize = 15

        console.log("Starting getDmMessages");

        if (!user_id) {
            res.status(400).json({ error: 'Invalid user_id parameter.' })
            return
        }

        const { data: threads } = await supabase
            .from('dm_threads')
            .select('id, user1_id, user2_id')
            .or(`user1_id.eq."${user_id}",user2_id.eq."${user_id}"`)


        if (!threads || threads.length === 0) {
            console.log("Thread not found for both peeps");
            res.status(200).json({ threads: [] })
            return
        }

        // Deduplicate threads by other user
        // const seenPairs = new Map<string, DmThread>()
        // threads.forEach(thread => {
        //     const otherUserId =
        //         thread.user1_id === user_id ? thread.user2_id : thread.user1_id
        //     if (!seenPairs.has(otherUserId)) {
        //         seenPairs.set(otherUserId, thread)
        //     }req.user?.sub
        // })

        const userthreads = threads
        const threadIds = userthreads.map(t => t.id)
        const otherUserIds = userthreads.map(t =>
            t.user1_id === user_id ? t.user2_id : t.user1_id
        )

        const { data: usersData } = await supabase
            .from('users')
            .select('id, username, avatar_url')
            .in('id', otherUserIds)

        const usersMap = new Map<string, any>()
        usersData?.forEach(u => usersMap.set(u.id, u))

        const { data: readStatuses } = await supabase
            .from('thread_read_status')
            .select('thread_id, last_read_at')
            .eq('user_id', user_id)
            .in('thread_id', threadIds)

        const readStatusMap = new Map<string, string>()
        readStatuses?.forEach(r => readStatusMap.set(r.thread_id, r.last_read_at))
        
        console.log("Fetching the Dms for: ",user_id,threadIds);

        const { data: messages } = await supabase        // const seenPairs = new Map<string, DmThread>()
        // threads.forEach(thread => {
        //     const otherUserId =
        //         thread.user1_id === user_id ? thread.user2_id : thread.user1_id
        //     if (!seenPairs.has(otherUserId)) {
        //         seenPairs.set(otherUserId, thread)
        //     }req.user?.sub
        // })
            .from('dm_messages')
            .select('*')
            .in('thread_id', threadIds)
            .order('timestamp', { ascending: false })
            .range(offset,offset+pageSize-1)
    

        // console.log(messages);

        var counter = 0;

        const messagesByThread = new Map<string, any[]>()
        messages?.forEach(msg => {
            const arr = messagesByThread.get(msg.thread_id) || []
            arr.push(msg)
            counter = counter + 1;
            messagesByThread.set(msg.thread_id, arr)
        })
        
        console.log(counter);
        
        const groupedThreads = userthreads.map(thread => {
            const otherUserId =
                thread.user1_id === user_id ? thread.user2_id : thread.user1_id
            const otherUser = usersMap.get(otherUserId) || null
            const msgs = messagesByThread.get(thread.id) || []

            const lastReadAt = readStatusMap.get(thread.id)

            const unreadCountMap = new Map<String,number>()

            readStatuses?.forEach(rs => {
                unreadCountMap.set(rs.thread_id, 0)
            })

            messages?.forEach(m=>{
                const lastReadAt = readStatusMap.get(m.thread_id)
                if(
                    m.sender_id !== user_id &&  
                    (!lastReadAt || new Date(m.timestamp) > new Date(lastReadAt)) 
                ) {
            
                    unreadCountMap.set(
                        m.thread_id,(unreadCountMap.get(m.thread_id) || 0) + 1
                    )

                }
        })
            const latestTimestamp =
                msgs.length > 0 ? msgs[0].timestamp : new Date(0).toISOString()

            return {
                thread_id: thread.id,
                messages: msgs.slice(0, 15),
                other_user: otherUser,
                unread_count: unreadCountMap.get(thread.id) || 0,
                recipient_id: otherUserId,
                latest_message_timestamp: latestTimestamp
            }
        })

        groupedThreads.sort(
            (a, b) =>
                new Date(b.latest_message_timestamp).getTime() -
                new Date(a.latest_message_timestamp).getTime()
        )

        res.status(200).json({ threads: groupedThreads })
    } catch (err) {
        console.error('Error in getDmMessages:', err)
        res.status(500).json({ error: 'Internal server error' })
    }
}

// Get unread message counts per thread
export const getUnreadCounts = async (req: Request, res: Response): Promise<void> => {
    try {
        const user_id = req.params.userId;

        if (!user_id || typeof user_id !== 'string') {
            res.status(400).json({ error: 'Invalid user_id parameter.' });
            return;
        }

        // Get all threads for the user
        const { data: threads, error: threadError } = await supabase
            .from('dm_threads')
            .select('id, user1_id, user2_id')
            .or(`user1_id.eq.${user_id},user2_id.eq.${user_id}`);

        if (threadError) {
            console.error('Error fetching threads:', threadError);
            res.status(500).json({ error: 'Failed to fetch threads.' });
            return;
        }

        if (!threads || threads.length === 0) {
            res.status(200).json({ unreadCounts: {}, totalUnread: 0 });
            return;
        }

        // Deduplicate threads
        const seenPairs = new Map<string, any>();
        threads.forEach(thread => {
            const otherUserId = thread.user1_id === user_id ? thread.user2_id : thread.user1_id;
            if (!seenPairs.has(otherUserId)) {
                seenPairs.set(otherUserId, thread)
                ;
            }
        });
        const uniqueThreads = Array.from(seenPairs.values());
        const threadIds = uniqueThreads.map(t => t.id);

        // Get the last read timestamp for each thread
        const { data: readStatuses, error: readError } = await supabase
            .from('thread_read_status')
            .select('thread_id, last_read_at')
            .eq('user_id', user_id)
            .in('thread_id', threadIds);

        if (readError && readError.code !== 'PGRST116') {
            console.error('Error fetching read statuses:', readError);
            // If table doesn't exist, fall back to counting all messages
        }

        // Create a map of thread_id to last_read_at
        const readStatusMap = new Map<string, string>();
        if (readStatuses) {
            readStatuses.forEach(status => {
                readStatusMap.set(status.thread_id, status.last_read_at);
            });
        }

        // Get unread message counts for each thread
        // Messages are unread if:
        // 1. Sender is NOT the current user
        // 2. Message timestamp is AFTER the last_read_at timestamp (or no read status exists)
        const { data: messages, error: msgError } = await supabase
            .from('dm_messages')
            .select('thread_id, sender_id, id, timestamp')
            .in('thread_id', threadIds)
            .neq('sender_id', user_id); // Only messages sent by others

        if (msgError) {
            console.error('Error fetching messages:', msgError);
            res.status(500).json({ error: 'Failed to fetch messages.' });
            return;
        }

        // Count unread messages per thread
        const unreadCounts: Record<string, number> = {};
        let totalUnread = 0;

        uniqueThreads.forEach(thread => {
            const lastReadAt = readStatusMap.get(thread.id);
            const threadMessages = messages?.filter(m => {
                if (m.thread_id !== thread.id) return false;
                
                // If no read status, all messages are unread
                if (!lastReadAt) return true;
                
                // Message is unread if timestamp is after last_read_at
                return new Date(m.timestamp) > new Date(lastReadAt);
            }) || [];
            
            unreadCounts[thread.id] = threadMessages.length;
            totalUnread += threadMessages.length;
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
        const { threadId } = req.params;
        const { userId } = req.body;

        if (!threadId || !userId) {
            res.status(400).json({ error: 'Thread ID and user ID are required.' });
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