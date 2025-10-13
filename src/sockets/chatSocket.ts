
import { Server, Socket } from "socket.io";
import { saveMessage } from "../lib/messageServices";
import { saveDMMessage } from "../lib/dmMessageServices";
import { supabase } from "../client/supabase";
import { UrlObject } from "url";

export const userSocketMap = new Map<string, string>(); // Map<userId, socketId>

let ioInstance: Server | null = null;

export const setIO = (io: Server) => {
  ioInstance = io;
  if(ioInstance === io){
    console.log("IO instance set successfully.");
  }
};

export const getIO = (): Server => {
  if (!ioInstance) throw new Error("Socket.IO has not been initialized yet.");
  return ioInstance;
};

export const setupChatSocket = (io: Server) => {
  io.on("connection", (socket: Socket) => { 
    console.log(`Chat Socket: User connected - ${socket.id}`);

    // The frontend sends the userId via socket.auth 
    const userId = socket.handshake.auth.userId;
    if (userId) {
      userSocketMap.set(userId, socket.id);
      console.log(`User ${userId} registered with socket ${socket.id}`);
    } else {
      console.warn(`No userId in handshake.auth for socket ${socket.id}`);
    }

    // chat for channel 
    socket.on("join_room", (channelId: string) => {
      socket.join(channelId);
      console.log(`User ${socket.id} joined chat room ${channelId}`);
    });


    socket.on('send_message', async (data: { channelId: string; senderId: string; content: string }) => {
      // 1. checking the coming data
      if (!data.channelId || !data.senderId || !data.content) {
        console.error('Invalid chat message payload:', data);
      }
      try {
        // 2. payload from services that we use to save the data..

        const savedMessage = await saveMessage({
          content: data.content,
          channel_id: data.channelId,
          sender_id: data.senderId,
        });

        // 3. If successful, broadcast the complete message from the DB to everyone in the room(Gemini comment  didnt understood why though...)
        io.to(data.channelId).emit('new_message', savedMessage);
        
        console.log(`Message from ${data.senderId} was saved and broadcasted to room ${data.channelId}`);

      } catch (error) {
        // 4. If an error occurs, log itx...
        console.error('Failed to save or broadcast message:', error);
        socket.emit('message_error', 'Your message could not be sent.');
      }
    });

    // (Removed redundant simple disconnect logger; cleanup handled below)
    // dm chat
    // This event should now only handle text-based DMs for performance.
    socket.on("send_dm", async (dmPayload: { senderId: string; receiverId: string; message: string; mediaurl?: UrlObject }) => {
        console.log('Received DM payload:', dmPayload);
        const { senderId, receiverId, message, mediaurl } = dmPayload;
        
        if (!receiverId || !senderId || !message) {
            console.error("Invalid DM payload:", dmPayload);
            socket.emit("dm_error", "Your DM is missing required information.");
            return;
        }

        try {
            // STEP 1: Correctly find or create the thread ID using persistent User IDs.
            console.log(`Processing DM from ${senderId} to ${receiverId}`);
            let threadId: string;
            
            // Sort the actual user IDs to ensure the thread is always found regardless of who sent the first message.
            const [user1_id, user2_id] = [senderId, receiverId].sort();

            const { data: existingThread } = await supabase
              .from('dm_threads')
              .select('id')
              .eq('user1_id', user1_id)
              .eq('user2_id', user2_id)
              .maybeSingle();
            
            // STEP 2: Handle both existing and new threads.
            if (existingThread) {
                threadId = existingThread.id;
                console.log(`Found existing DM thread ${threadId} for users ${user1_id} and ${user2_id}`);
            } else {
                // If the thread doesn't exist, create it.
                console.log(`Creating new DM thread for users ${user1_id} and ${user2_id}`);
                const { data: newThread, error: newThreadError } = await supabase
                    .from('dm_threads')
                    .insert({ user1_id, user2_id })
                    .select('id')
                    .single();

                if (newThreadError) {
                    throw newThreadError;
                }
                threadId = newThread.id;
                console.log(`Created new DM thread ${threadId}`);
              }

            // STEP 3: Save the message using the determined threadId.
            const extendedDmPayload = {
              ...dmPayload,
              threadId: threadId 
            };
            console.log('Saving DM message with payload:', extendedDmPayload);
            
            const savedDm = await saveDMMessage(extendedDmPayload);
            console.log('DM saved successfully:', savedDm);

            // STEP 4: Emit to the recipient (if online) and send confirmation to the sender.
            // Use the clean, consistent data object from the database (`savedDm`).
            const receiverSocketId = userSocketMap.get(receiverId);
            if (receiverSocketId) {
                console.log(`Emitting DM to online receiver ${receiverId} at socket ${receiverSocketId}`);
                io.to(receiverSocketId).emit("receive_dm", savedDm);
            } else {
                console.log(`User ${receiverId} is offline. DM is stored.`);
            }

            // Send confirmation back to the sender so their UI updates instantly.
            socket.emit("dm_sent_confirmation");

        } catch (error) {
            console.error("Failed to process DM:", error);
            socket.emit("dm_error", "Your DM could not be sent due to a server error.");
        }
    });

    socket.on("disconnect", () => {
      for (const [key, value] of userSocketMap.entries()) {
        if (value === socket.id) {
          userSocketMap.delete(key);
          console.log(`User ${key} unregistered and disconnected.`);
          break;
        }
      }
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};