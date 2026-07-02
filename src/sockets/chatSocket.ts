
import { Server, Socket } from "socket.io";
import { supabase } from "../client/supabase";
import { checkChannelSendPermission } from "../controllers/channelController";
import { saveDMMessage } from "../services/dmService"
import { saveMessage } from "../lib/messageServices";
import { extractGifMediaUrl } from "../lib/messageMedia";
import { markUserOffline, markUserOnline } from "../lib/userPresence";
import { sendChannelPushNotification, sendDmPushNotification } from "../notifications/pushNotificationService";
import { deleteUserSocket, getUserSocket, setUserSocket } from "../redis/userSocketStore";

export const userSocketMap = new Map<string, string>(); // Map<userId, socketId>

let ioInstance: Server | null = null;

export const setIO = (io: Server) => {
  ioInstance = io;
};

export const getIO = (): Server => {
  if (!ioInstance) throw new Error("Socket.IO has not been initialized yet.");
  return ioInstance;
};

export const setupChatSocket = (io: Server) => {
  io.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth?.token;
    const clientUserId = socket.handshake.auth?.userId; // Backward compatibility


    let userId: string | null = null;

    // Prefer token verification (new secure method)
    if (token) {
      try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user?.id) {
          console.warn(`[chatSocket] Invalid token for socket ${socket.id}:`, error?.message || "No user in token");
          // DEBUG: Fall back to legacy userId if token fails (temporary - remove in production)
          if (clientUserId) {
            console.warn(`[chatSocket] Using legacy userId fallback for socket ${socket.id}`);
            userId = clientUserId;
          } else {
            socket.emit("auth_error", { code: "INVALID_TOKEN", message: "Invalid or expired token" });
            socket.disconnect();
            return;
          }
        } else {
          userId = data.user.id;
        }
      } catch (err: any) {
        console.error(`[chatSocket] Token verification error for socket ${socket.id}:`, err?.message || err);
        // DEBUG: Fall back to legacy userId if token verification throws (temporary)
        if (clientUserId) {
          console.warn(`[chatSocket] Using legacy userId fallback after token error for socket ${socket.id}`);
          userId = clientUserId;
        } else {
          socket.emit("auth_error", { code: "AUTH_ERROR", message: "Authentication failed" });
          socket.disconnect();
          return;
        }
      }
    } else if (clientUserId) {
      // Backward compatibility: trust userId from client (will be removed in future)
      console.warn(`[chatSocket] Socket ${socket.id} using legacy userId auth - migrate to token auth`);
      userId = clientUserId;
    } else {
      console.warn(`[chatSocket] No authentication provided for socket ${socket.id}`);
      socket.emit("auth_error", { code: "AUTH_REQUIRED", message: "Authentication required" });
      socket.disconnect();
      return;
    }

    // Store verified userId in socket data for use in handlers
    socket.data.userId = userId;
    userSocketMap.set(userId as string, socket.id);
    // Redis store for cross-instance DM delivery (app instance A, web instance B)
    setUserSocket(userId as string, socket.id).catch((err) =>
      console.error("[chatSocket] Failed to set userSocket in Redis:", err)
    );
    markUserOnline(userId as string).catch((err) =>
      console.error("[chatSocket] Failed to mark user online:", err)
    );

    socket.on("presence:heartbeat", async () => {
      const activeUserId = socket.data.userId as string | undefined;
      if (!activeUserId) return;

      try {
        await setUserSocket(activeUserId, socket.id);
        await markUserOnline(activeUserId);
        socket.emit("presence:heartbeat_ack", { status: "ONLINE", timestamp: new Date().toISOString() });
      } catch (error) {
        console.error("[chatSocket] Failed to process presence heartbeat:", error);
      }
    });

    // chat for channel 
    socket.on("join_room", (channelId: string) => {
      socket.join(channelId);
    });


    socket.on('send_message', async (data: { channelId: string; senderId: string; content: string; tempId?: string }) => {
      // Use server-verified userId instead of client-provided senderId
      const verifiedSenderId = socket.data.userId;

      // 1. checking the coming data
      if (!data.channelId || !data.content) {
        console.error('Invalid chat message payload:', data);
        socket.emit('message_error', { error: 'Invalid message data.', tempId: data.tempId });
        return;
      }

      if (!verifiedSenderId) {
        console.error('No verified userId for socket:', socket.id);
        socket.emit('message_error', { error: 'Authentication required', tempId: data.tempId });
        return;
      }

      // 🔒 SECURITY: Verify the senderId matches the authenticated user (prevent impersonation)
      if (data.senderId !== verifiedSenderId) {
        console.error(`SECURITY: User ${verifiedSenderId} attempted to impersonate ${data.senderId}`);
        socket.emit('message_error', { error: 'Unauthorized: User ID mismatch.', tempId: data.tempId });
        return;
      }

      try {
        // 🔒 SECURITY: Check if user has permission to send messages in this channel
        const permissionCheck = await checkChannelSendPermission(verifiedSenderId, data.channelId);

        if (!permissionCheck.canSend) {
          socket.emit('message_error', {
            error: permissionCheck.error || 'You do not have permission to send messages in this channel.',
            tempId: data.tempId
          });
          return;
        }

        // 2. payload from services that we use to save the data..
        // Using verifiedSenderId instead of data.senderId for security
        // Save the message to the database
        const gifMediaUrl = extractGifMediaUrl(data.content);
        const savedMessage = await saveMessage({
          content: gifMediaUrl ? '' : data.content,
          channel_id: data.channelId,
          sender_id: verifiedSenderId,
          media_url: gifMediaUrl,
        });

        // Add tempId to the saved message for frontend matching
        const messageWithTempId = { ...savedMessage, tempId: data.tempId };

        // Send confirmation to sender ONLY (for optimistic UI update)
        socket.emit('message_confirmed', messageWithTempId);

        // Broadcast to everyone in the room EXCEPT the sender
        // This prevents duplicate messages on the sender's UI
        socket.to(data.channelId).emit('new_message', savedMessage);

        // Fire-and-forget: push notification to offline channel members
        sendChannelPushNotification(
          verifiedSenderId,
          data.channelId,
          gifMediaUrl ? '' : data.content
        ).catch(console.error);

      } catch (error) {
        // If an error occurs, log it and notify the sender
        console.error('Failed to save or broadcast message:', error);
        socket.emit('message_error', { error: 'Your message could not be sent.', tempId: data.tempId });
      }
    });

    // dm chat
    socket.on("send_dm", async (dmPayload: {
      senderId: string;
      receiverId: string;
      message?: string;
      media_url?: string | null;
      media_urls?: string[];
      tempId?: string;
    }) => {
      // Use server-verified userId instead of client-provided senderId
      const verifiedSenderId = socket.data.userId;
      const { senderId, receiverId, message, media_url, media_urls, tempId } = dmPayload;

      if (!verifiedSenderId) {
        console.error("No verified userId for socket:", socket.id);
        socket.emit("dm_error", { error: "Authentication required", tempId });
        return;
      }

      const normalizedMessage = (message || '').trim();
      const gifMediaUrl = extractGifMediaUrl(normalizedMessage);
      const normalizedMediaUrls = [
        ...(Array.isArray(media_urls) ? media_urls : []),
        ...(typeof media_url === 'string' && media_url.trim() ? [media_url.trim()] : []),
        ...(gifMediaUrl ? [gifMediaUrl] : []),
      ].filter((item) => typeof item === 'string' && item.trim().length > 0);

      if (!receiverId || (!normalizedMessage && normalizedMediaUrls.length === 0)) {
        console.error("Invalid DM payload:", dmPayload);
        socket.emit("dm_error", { error: "Your DM is missing required information.", tempId });
        return;
      }

      // 🔒 SECURITY: Verify the senderId matches the authenticated user (prevent impersonation)
      if (senderId !== verifiedSenderId) {
        console.error(`SECURITY: User ${verifiedSenderId} attempted to impersonate ${senderId} in DM`);
        socket.emit("dm_error", { error: "Unauthorized: User ID mismatch.", tempId });
        return;
      }

      try {
        // STEP 1: Correctly find or create the thread ID using persistent User IDs.
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
        } else {
          // If the thread doesn't exist, create it.
          const { data: newThread, error: newThreadError } = await supabase
            .from('dm_threads')
            .insert({ user1_id, user2_id })
            .select('id')
            .single();

          if (newThreadError) {
            throw newThreadError;
          }
          threadId = newThread.id;
        }

        // STEP 3: Save the message using the determined threadId.
        // Use verified senderId for security
        const extendedDmPayload = {
          senderId: verifiedSenderId,
          receiverId,
          message: normalizedMessage,
          media_url: normalizedMediaUrls.length === 0
            ? null
            : normalizedMediaUrls.length === 1
              ? normalizedMediaUrls[0]
              : JSON.stringify(normalizedMediaUrls),
          threadId: threadId
        };

        const savedDm = await saveDMMessage(extendedDmPayload);

        // STEP 4: Emit to the recipient (if online) and send confirmation to the sender.
        // Include tempId for optimistic UI matching
        const savedDmWithTempId = { ...savedDm, tempId };

        // Send confirmation to sender for optimistic UI update
        socket.emit("dm_confirmed", savedDmWithTempId);
        // Send to recipient (if online) - check local map first, then Redis for cross-instance
        let receiverSocketId = userSocketMap.get(receiverId);
        if (!receiverSocketId) {
          receiverSocketId = (await getUserSocket(receiverId)) || undefined;
        }
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("receive_dm", savedDm);
        } else {
          console.warn(`[chatSocket] Receiver ${receiverId} not found (local or Redis) - cannot deliver receive_dm in real time`);
        }

        // Fire-and-forget: push notification (app may be backgrounded even if socket exists)
        sendDmPushNotification(
          verifiedSenderId,
          receiverId,
          normalizedMessage,
          String(savedDm.thread_id || threadId)
        ).catch(console.error);

      } catch (error) {
        console.error("Failed to process DM:", error);
        socket.emit("dm_error", { error: "Your DM could not be sent due to a server error.", tempId });
      }
    });

    socket.on("disconnect", () => {
      const uid = socket.data.userId as string | undefined;
      if (uid) {
        if (userSocketMap.get(uid) === socket.id) {
          userSocketMap.delete(uid);
        }

        deleteUserSocket(uid, socket.id)
          .then(async (remainingSockets) => {
            if (remainingSockets === 0) {
              await markUserOffline(uid);
            }
          })
          .catch((err) =>
            console.error("[chatSocket] Failed to delete userSocket from Redis:", err)
          );
      }
    });
  });
};
