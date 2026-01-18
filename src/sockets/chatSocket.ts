
import { Server, Socket } from "socket.io";
import { saveMessage } from "../lib/messageServices";
import { saveDMMessage } from "../lib/dmMessageServices";
import { supabase } from "../client/supabase";
import { UrlObject } from "url";

export const userSocketMap = new Map<string, string>(); // Map<userId, socketId>

let ioInstance: Server | null = null;

export const setIO = (io: Server) => {
  ioInstance = io;
  // if(ioInstance === io){
  //   console.log("IO instance set successfully.");
  // }
};

export const getIO = (): Server => {
  if (!ioInstance) throw new Error("Socket.IO has not been initialized yet.");
  return ioInstance;
};

export const setupChatSocket = (io: Server) => {
  io.on("connection", async (socket: Socket) => { 
    // console.log(`Chat Socket: User connected - ${socket.id}`);

    const token = socket.handshake.auth.token;
    const clientUserId = socket.handshake.auth.userId; // Backward compatibility
    
    let userId: string | null = null;
    
    // Prefer token verification (new secure method)
    if (token) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user?.id) {
          console.warn(`Invalid token for socket ${socket.id}:`, error?.message);
          socket.emit("auth_error", { code: "INVALID_TOKEN", message: "Invalid or expired token" });
          socket.disconnect();
          return;
        }
        userId = data.user.id;
        // console.log(`Socket ${socket.id} authenticated via token for user ${userId}`);
      } catch (err) {
        console.error(`Token verification error for socket ${socket.id}:`, err);
        socket.emit("auth_error", { code: "AUTH_ERROR", message: "Authentication failed" });
        socket.disconnect();
        return;
      }
    } else if (clientUserId) {
      // Backward compatibility: trust userId from client (will be removed in future)
      console.warn(`Socket ${socket.id} using legacy userId auth - migrate to token auth`);
      userId = clientUserId;
    } else {
      console.warn(`No authentication provided for socket ${socket.id}`);
      socket.emit("auth_error", { code: "AUTH_REQUIRED", message: "Authentication required" });
      socket.disconnect();
      return;
    }
    
    // Store verified userId in socket data for use in handlers
    socket.data.userId = userId;
    userSocketMap.set(userId as string, socket.id);
    // console.log(`User ${userId} registered with socket ${socket.id}`);

    // chat for channel 
    socket.on("join_room", (channelId: string) => {
      socket.join(channelId);
      // console.log(`User ${socket.id} joined chat room ${channelId}`);
    });


    socket.on('send_message', async (data: { channelId: string; senderId: string; content: string }) => {
      // Use server-verified userId instead of client-provided senderId
      const verifiedSenderId = socket.data.userId;
      
      // 1. checking the coming data
      if (!data.channelId || !data.content) {
        console.error('Invalid chat message payload:', data);
        return;
      }
      
      if (!verifiedSenderId) {
        console.error('No verified userId for socket:', socket.id);
        socket.emit('message_error', 'Authentication required');
        return;
      }
      
      try {
        // 2. payload from services that we use to save the data..
        // Using verifiedSenderId instead of data.senderId for security

        const savedMessage = await saveMessage({
          content: data.content,
          channel_id: data.channelId,
          sender_id: verifiedSenderId,
        });

        // 3. If successful, broadcast the complete message from the DB to everyone in the room
        io.to(data.channelId).emit('new_message', savedMessage);
        
        // console.log(`Message from ${data.senderId} was saved and broadcasted to room ${data.channelId}`);

      } catch (error) {
        // 4. If an error occurs, log it...
        console.error('Failed to save or broadcast message:', error);
        socket.emit('message_error', 'Your message could not be sent.');
      }
    });

    // dm chat
    // This event should now only handle text-based DMs for performance.
    socket.on("send_dm", async (dmPayload: { senderId: string; receiverId: string; message: string; mediaurl?: UrlObject }) => {
        // console.log('Received DM payload:', dmPayload);
        // Use server-verified userId instead of client-provided senderId
        const verifiedSenderId = socket.data.userId;
        const { receiverId, message, mediaurl } = dmPayload;
        
        if (!verifiedSenderId) {
            console.error("No verified userId for socket:", socket.id);
            socket.emit("dm_error", "Authentication required");
            return;
        }
        
        if (!receiverId || !message) {
            console.error("Invalid DM payload:", dmPayload);
            socket.emit("dm_error", "Your DM is missing required information.");
            return;
        }

        try {
            // STEP 1: Correctly find or create the thread ID using persistent User IDs.
            // console.log(`Processing DM from ${verifiedSenderId} to ${receiverId}`);
            let threadId: string;
            
            // Sort the actual user IDs to ensure the thread is always found regardless of who sent the first message.
            const [user1_id, user2_id] = [verifiedSenderId, receiverId].sort();

            const { data: existingThread } = await supabase
              .from('dm_threads')
              .select('id')
              .eq('user1_id', user1_id)
              .eq('user2_id', user2_id)
              .maybeSingle();
            
            // STEP 2: Handle both existing and new threads.
            if (existingThread) {
                threadId = existingThread.id;
                // console.log(`Found existing DM thread ${threadId} for users ${user1_id} and ${user2_id}`);
            } else {
                // If the thread doesn't exist, create it.
                // console.log(`Creating new DM thread for users ${user1_id} and ${user2_id}`);
                const { data: newThread, error: newThreadError } = await supabase
                    .from('dm_threads')
                    .insert({ user1_id, user2_id })
                    .select('id')
                    .single();

                if (newThreadError) {
                    throw newThreadError;
                }
                threadId = newThread.id;
                // console.log(`Created new DM thread ${threadId}`);
              }

            // STEP 3: Save the message using the determined threadId.
            // Use verified senderId for security
            const extendedDmPayload = {
              senderId: verifiedSenderId,
              receiverId,
              message,
              mediaurl,
              threadId: threadId 
            };
            // console.log('Saving DM message with payload:', extendedDmPayload);
            
            const savedDm = await saveDMMessage(extendedDmPayload);
            // console.log('DM saved successfully:', savedDm);

            // STEP 4: Emit to the recipient (if online) and send confirmation to the sender.
            // Use the clean, consistent data object from the database (`savedDm`).
            const receiverSocketId = userSocketMap.get(receiverId);
            if (receiverSocketId) {
                // console.log(`Emitting DM to online receiver ${receiverId} at socket ${receiverSocketId}`);
                io.to(receiverSocketId).emit("receive_dm", savedDm);
            } else {
                // console.log(`User ${receiverId} is offline. DM is stored.`);
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
          // console.log(`User ${key} unregistered and disconnected.`);
          break;
        }
      }
      // console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};