import { Request, Response } from "express";
import { supabase } from '../client/supabase'; // Adjust path if necessary
import { v4 as uuidv4, v4 } from 'uuid';
import { saveMessage } from "../lib/messageServices";

export const dmMessagePostController = async (req: Request, res: Response): Promise<any> => {
    try {
        const { content, sender_id, receiver_id, reply_to } = req.body;

        if (!sender_id || !receiver_id) {
            return res.status(400).json({ msg: "sender_id and receiver_id are required." });
        }

        // --- 1. Find or Create the DM Thread (same logic as before) ---
        let threadId: string;
        const [user1_id, user2_id] = [sender_id, receiver_id].sort();

        const { data: existingThread } = await supabase
            .from('dm_threads')
            .select('id')
            .eq('user1_id', user1_id)
            .eq('user2_id', user2_id)
            .maybeSingle();

        if (existingThread) {
            threadId = existingThread.id;
        } else {
            const newThreadId = uuidv4();
            const { error: threadInsertError } = await supabase.from('dm_threads').insert({
                id: newThreadId,
                user1_id,
                user2_id,
            });
            if (threadInsertError) throw new Error('Could not create new DM thread.');
            threadId = newThreadId;
        }

        // --- 2. Handle Optional File Upload (same logic as before) ---
        let media_url: string | null = null;
        if (req.file) {
            const fileId = uuidv4();
            const fileExt = req.file.originalname.split('.').pop();
            const fileName = `${fileId}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('attachments') // Ensure this is your correct bucket name
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: false,
                });

            if (uploadError) throw new Error('Could not upload file.');

            const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(fileName);
            media_url = publicUrlData.publicUrl;
        }

        // --- 3. Insert the Message AND get it back ---
        const messageId = uuidv4();
        const newMessagePayload = {
            id: messageId,
            content: content || '', // Ensure content is not undefined
            media_url,
            is_edited: false,
            thread_id: threadId,
            sender_id,
            reply_to: reply_to || null,
        };

        const { data: savedMessage, error: insertError } = await supabase
            .from('dm_messages')
            .insert(newMessagePayload)
            .select() // Use .select() to return the inserted row
            .single(); // We expect only one row back

        if (insertError) {
            console.error("Error inserting DM:", insertError);
            return res.status(500).json({ error: 'Server error while saving message' });
        }

        // --- 4. CRITICAL FIX: Broadcast the message via Sockets ---
        // Access io and userSocketMap from the request object
        const io = req.app.get('socketio');
        const userSocketMap = req.app.get('userSocketMap');

        const receiverSocketId = userSocketMap.get(receiver_id);
        const senderSocketId = userSocketMap.get(sender_id);

        // Prepare a payload that matches the frontend's DirectMessage interface
        const broadcastPayload = {
            ...savedMessage,
            timestamp: new Date(savedMessage.timestamp).toISOString(), // Ensure timestamp is in a consistent format
        };

        // Emit to the receiver if they are online
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("receive_dm", broadcastPayload);
        }

        // Also emit a confirmation back to the sender so their UI updates
        if (senderSocketId) {
            io.to(senderSocketId).emit("dm_sent_confirmation", broadcastPayload);
        }
        
        // --- 5. Send the full message object back as the HTTP response ---
        res.status(201).json(broadcastPayload);

    } catch (error: any) {
        console.error(`Error in dmMessagePostController: ${error.message}`);
        return res.status(500).json({ msg: "Server Error" });
    }
}


export const messagePostController = async (req:Request, res:Response):Promise<any> => {
    try {
        const id = v4(); 
        const {content, channel_id, sender_id, reply_to} = req.body;
        
        if (!channel_id) {
            return res.status(400).json({'error':'No channelId received.'});
        } 
        if (!sender_id) {
            return res.status(400).json({'error':'No senderId received.'});
        }

        let media_url:string | null = null;
        
        if (req.file) {
            const fileExt = req.file.originalname.split('.').pop();
            const fileName = `${id}.${fileExt}`;

            const { data, error: uploadError } = await supabase.storage
                .from('attachments')
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: true,
                });

            if (uploadError) {
                console.error(uploadError);
                return res.status(500).json({'error':'Server error during file upload'});
            }

            const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(fileName);
            media_url = publicUrlData.publicUrl;
        }
        
        // 1. calling shared service to save the message data.
        const savedMessage = await saveMessage({
            content,
            channel_id,
            sender_id,
            media_url, // Pass the file URL if it exists
        });

        // 3. Get the socket.io instance and broadcast the new message.
        // in main server file: app.set('socketio', io);
        const io = req.app.get('socketio');
        io.to(channel_id).emit('new_message', savedMessage);
        
        console.log(`Message with media from ${sender_id} was broadcasted to room ${channel_id}`);

        // 4. Send a success response back to the client that made the upload request.
        return res.status(200).json({
            msg: 'Message sent successfully',
            message: savedMessage,
        });
        
    } catch(error:any) {
        console.error(error);
        return res.status(500).json({error:'Server error'});
    }
};

/* note : for every get message request , we send 15 messages. */
/* if the offset received is 0 , we send latest 15 messgages. 
    if the offset is 1 , then we send the next 15 messages and so on */
export const messageGetController = async (req:Request, res:Response):Promise<any>=>{
    try{
        const channel_id:string = req.query.channel_id as string;
        const offset:number = parseInt(req.query.offset as string) || 0;
        /* if no offset is received , then we assume 0 as offset*/
        const is_dm:boolean = (req.query.is_dm === 'true');
        
        if(!channel_id){
            return res.status(400).json({msg:'No channelId received'});
        }
        if(offset < 0){
            return res.status(400).json({msg:'offset cannot be negative'});
        }

        const from = offset * 15;
        const to = from + 14;

        //get appropriate table and column name for the channel/thread.
        const table:string = (is_dm)?'dm_messages':'messages';
        const channel:string = (is_dm)?'thread_id':'channel_id';

        /* fetch data*/
        const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq(channel, channel_id)
        .order('timestamp', { ascending: false }) //latest messages
        .range( from, to ); //send 15 messages

        if(error){
            console.error('Error fetching messages:', error);
            return res.status(500).json({msg:'Server Error'});
        }else{
            console.log('Fetched messages:', data);
            return res.status(200).json({data});
        }
    }
    catch(e:any){
        console.log(`Error in GET message : ${e}`);
        return res.status(500).json({'msg':'Server Error'});
    }
}


// Define interfaces for type safety and clarity
interface Profile {
    id: string;
    username: string;
    avatar_url: string;
}

interface LastMessage {
    content: string;
    created_at: string;
    sender_id: string;
}

interface DmThread {
    id: string;
    user1_id:string;
    user2_id:string;
}

/**
 * Fetches ALL messages received by a user across ALL their DM threads.
 *
 * This function is useful for features like a global inbox or notification center.
 */

/*
export const getDmMessages = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        if (!userId) {
            res.status(400).json({ error: 'User ID is required in the URL.' });
            return 
        }

        // This query starts from the `dm_messages` table and uses a join to filter
        // based on the threads the user is a member of.
        const { data: messages, error } = await supabase
            .from('dm_messages')
            .select(`
                id,
                content,
                media_url,
                timestamp,
                sender_id,
                dm_threads!inner ( user1_id, user2_id )
            `)
            // CRITICAL 1: Only get messages where the sender is NOT the current user.
            .not('sender_id', 'eq', userId)
            // CRITICAL 2: Only look in threads where the current user is either user1 or user2.
            .or(`user1_id.eq.${userId},user2_id.eq.${userId}`, { foreignTable: 'dm_threads' })
            .order('timestamp', { ascending: false }); // Order by newest first

        if (error) {
            console.error('Error fetching all received DMs:', error);
            res.status(500).json({ error: 'Could not fetch received DMs.' });
            return 
        }

        res.status(200).json(messages || []);
        return 

    } catch (err) {
        console.error('Server error in getAllReceivedDmMessages:', err);
        res.status(500).json({ error: 'Server error.' });
        return 
    }
};
*/


export const getDmMessages = async (req: Request, res: Response): Promise<void> => {
    try {
        const user_id = req.params.userId;

        if (!user_id || typeof user_id !== 'string') {
            res.status(400).json({ error: 'user_id is required as a parameter.' });
            return;
        }

        // Step 1: Find all DM threads where the user is a participant (No change here)
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

        // --- OPTIMIZATION START ---

        // Step 2: Collect all unique IDs of the other users and all thread IDs
        const otherUserIds = threads.map(thread => 
            thread.user1_id === user_id ? thread.user2_id : thread.user1_id
        );
        const threadIds = threads.map(thread => thread.id);

        // Step 3: Fetch all required user profiles in a single query
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id, username, avatar_url')
            .in('id', otherUserIds);

        if (usersError) {
            console.error('Error fetching user profiles:', usersError);
            res.status(500).json({ error: 'Failed to fetch user profiles.' });
            return;
        }
        // Create a map for easy lookup: { 'user-id-123': { id: '...', username: '...' } }
        const usersMap = new Map(usersData.map(user => [user.id, user]));

        // Step 4: Fetch all messages from all relevant threads in a single query
        const { data: allMessages, error: messagesError } = await supabase
            .from('dm_messages')
            .select('*')
            .in('thread_id', threadIds)
            .order('timestamp', { ascending: true }); // Fetch in ascending order for easier grouping

        if (messagesError) {
            console.error('Error fetching messages:', messagesError);
            res.status(500).json({ error: 'Failed to fetch messages.' });
            return;
        }

        // Step 5: Group the messages by thread_id on the server
        const messagesByThread = new Map<string, any[]>();
        allMessages.forEach(message => {
            const threadMessages = messagesByThread.get(message.thread_id) || [];
            threadMessages.push(message);
            messagesByThread.set(message.thread_id, threadMessages);
        });

        // Step 6: Combine the data into the final response structure
        const groupedMessages = threads.map(thread => {
            const otherUserId = thread.user1_id === user_id ? thread.user2_id : thread.user1_id;
            const otherUser = usersMap.get(otherUserId) || null;
            const messages = messagesByThread.get(thread.id) || [];
            
            // Optionally, limit to the last 15 messages here if needed, now that they are grouped.
            const recentMessages = messages.slice(-15);

            return {
                thread_id: thread.id,
                messages: recentMessages,
                other_user: otherUser
            };
        });
        
        // --- OPTIMIZATION END ---
        res.status(200).json({ threads: groupedMessages });
    } catch (err) {
        console.error('Unexpected server error in getDmMessages:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};