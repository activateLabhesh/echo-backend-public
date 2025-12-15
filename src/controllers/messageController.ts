import { Request, Response } from "express";
import { supabase } from '../client/supabase';
import { v4 } from 'uuid';
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { getIO, userSocketMap } from "../sockets/chatSocket";
import { parseMentions, resolveMentions, processMentions } from '../lib/mentionParser';

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
        const sender_id = req.user?.sub || body.sender_id as string;
        // Support both upload.single() (req.file) and upload.fields() (req.files)
        const anyReq = req as any;
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
        let threadId: string;
        const [user1_id, user2_id] = [sender_id, receiver_id].sort();

        const { data: existingThread, error: findThreadError } = await supabase
            .from('dm_threads')
            .select('id')
            .eq('user1_id', user1_id)
            .eq('user2_id', user2_id)
            .maybeSingle();

        if (findThreadError) {
            console.error('Error finding DM thread:', findThreadError);
            return res.status(500).json({ error: 'Server error finding DM thread' });
        }

        if (existingThread) {
            threadId = (existingThread as any).id;
        } else {
            const { data: newThread, error: threadInsertError } = await supabase
                .from('dm_threads')
                .insert({ user1_id, user2_id })
                .select('id')
                .single();
            if (threadInsertError) {
                console.error('Error creating new DM thread:', threadInsertError);
                return res.status(500).json({ error: 'Could not create new DM thread.' });
            }
            threadId = (newThread as any).id;
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

        // 5. Broadcast via Sockets
        const io = getIO();
        const receiverSocketId = userSocketMap.get(receiver_id);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("receive_dm", savedMessage);
        }
        const senderSocketId = userSocketMap.get(sender_id);
        if (senderSocketId) {
            io.to(senderSocketId).emit("dm_sent_confirmation");
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
            media_url
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

        const io = getIO();
        io.to(channel_id).emit("new_message", savedMessage);
        
        return res.status(200).json(savedMessage);

    } catch(error:any) {
        console.error(error);
        return res.status(500).json({error:'Server error'});
    }
};

export const messageGetController = async (req:Request, res:Response):Promise<any>=>{
    try{
        const channel_id  = req.query?.channel_id as string;
        const offset = parseInt(req.query?.offset as string, 10) || 0; // Pagination offset
        const pageSize = 15; // Number of messages per request

        if(!channel_id ){
            return res.status(400).json({msg:'Invalid channelId received'});
        }

        // Get total count for hasMore calculation
        const { count, error: countError } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('channel_id', channel_id);

        if(countError){
            console.error('Error counting messages:', countError);
        }

        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('channel_id', channel_id)
            .order('timestamp', { ascending: false })
            .range(offset, offset + pageSize - 1); // Apply pagination here

        if(error){
            console.error('Error fetching messages:', error);
            return res.status(500).json({msg:'Server Error'});
        }

        const senderIds = data ? Array.from(new Set(data.map((msg:any) => msg.sender_id))) : [];
        let usersMap = new Map();
        if(senderIds.length > 0){
            const { data: usersData, error: usersError } = await supabase
                .from('users')
                .select('id, username')
                .in('id', senderIds);
            if(usersError){
                console.error('Error fetching user names:', usersError);
            } else if(usersData) {
                usersMap = new Map(usersData.map((user:any) => [user.id, user.username]));
            }
        }

        const messagesWithUsernames = data ? data.map((msg:any) => ({
            ...msg,
            username: usersMap.get(msg.sender_id) || null
        })) : [];

        const totalCount = count || 0;
        const hasMore = offset + pageSize < totalCount;

        return res.status(200).json({
            data: messagesWithUsernames,
            hasMore,
            totalCount
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

        if (!threadId) {
            return res.status(400).json({ error: 'Thread ID is required.' });
        }

        // Get total count for hasMore calculation
        const { count, error: countError } = await supabase
            .from('dm_messages')
            .select('*', { count: 'exact', head: true })
            .eq('thread_id', threadId);

        if (countError) {
            console.error('Error counting DM messages:', countError);
        }

        // Fetch messages with pagination (descending order to get newest first, then reverse on frontend)
        const { data, error } = await supabase
            .from('dm_messages')
            .select('*')
            .eq('thread_id', threadId)
            .order('timestamp', { ascending: false })
            .range(offset, offset + pageSize - 1);

        if (error) {
            console.error('Error fetching DM thread messages:', error);
            return res.status(500).json({ error: 'Failed to fetch messages.' });
        }

        const totalCount = count || 0;
        const hasMore = offset + pageSize < totalCount;

        return res.status(200).json({
            data: data || [],
            hasMore,
            totalCount
        });
    } catch (err) {
        console.error('Unexpected error in getDmThreadMessages:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getDmMessages = async (req: Request, res: Response): Promise<void> => {
    try {
        const user_id = req.params.userId;

        if (!user_id || typeof user_id !== 'string') {
            res.status(400).json({ error: 'Invalid user_id parameter.' });
            return;
        }

        const { data: threads, error: threadError } = await supabase
            .from('dm_threads')
            .select('id, user1_id, user2_id')
            .or(`user1_id.eq.${user_id},user2_id.eq.${user_id}`) as { data: DmThread[]; error: any };

        if (threadError) {
            console.error('Error fetching user threads:', threadError);
            res.status(500).json({ error: 'Failed to fetch user threads.' });
            return;
        }

        if (!threads || threads.length === 0) {
            res.status(200).json({ threads: [] });
            return;
        }

        const otherUserIds = threads.map(thread => 
            thread.user1_id === user_id ? thread.user2_id : thread.user1_id
        );
        const threadIds = threads.map(thread => thread.id);

        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id, username, avatar_url')
            .in('id', otherUserIds);

        if (usersError) {
            console.error('Error fetching user profiles:', usersError);
            res.status(500).json({ error: 'Failed to fetch user profiles.' });
            return;
        }
        const usersMap = new Map(usersData.map(user => [user.id, user]));

        const { data: allMessages, error: messagesError } = await supabase
            .from('dm_messages')
            .select('*')
            .in('thread_id', threadIds)
            .order('timestamp', { ascending: true });

        if (messagesError) {
            console.error('Error fetching messages:', messagesError);
            res.status(500).json({ error: 'Failed to fetch messages.' });
            return;
        }

        const messagesByThread = new Map<string, any[]>();
        allMessages.forEach(message => {
            const threadMessages = messagesByThread.get(message.thread_id) || [];
            threadMessages.push(message);
            messagesByThread.set(message.thread_id, threadMessages);
        });

        const groupedMessages = threads.map(thread => {
            const otherUserId = thread.user1_id === user_id ? thread.user2_id : thread.user1_id;
            const otherUser = usersMap.get(otherUserId) || null;
            const messages = messagesByThread.get(thread.id) || [];
            const recentMessages = messages.slice(-15);

            return {
                thread_id: thread.id,
                messages: recentMessages,
                other_user: otherUser
            };
        });
        
        res.status(200).json({ threads: groupedMessages });
    } catch (err) {
        console.error('Unexpected server error in getDmMessages:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};