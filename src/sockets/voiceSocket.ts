// src/sockets/voiceSocket.ts
import { Server, Socket } from 'socket.io';
import { getIO } from './chatSocket';
import { userSocketMap } from './chatSocket'; // <-- IMPORTANT: Import the userSocketMap

export function setupVoiceSocket() {
  const channelUsers = new Map<string, string[]>(); // Map<channelId, socketId[]>
  
  // New map to store user voice states
  const voiceStates = new Map<string, { userId: string, muted: boolean, speaking: boolean, video: boolean }>(); // Map<socketId, state>

  const io = getIO();

  if (io) {
    console.log("Voice Socket.IO instance set successfully.");
  }

  // Helper function to get userId from socketId using the shared map
  const getUserIdFromSocketId = (socketId: string): string | null => {
      for (const [key, value] of userSocketMap.entries()) {
          if (value === socketId) {
              return key;
          }
      }
      return null;
  };

  io.on('connection', (socket) => {
    console.log(`User connected for voice: ${socket.id}`);
    
    // Get the userId from the userSocketMap
    const userId = getUserIdFromSocketId(socket.id);

    // Initial validation
    if (!userId) {
      console.error(`Socket ${socket.id} not found in userSocketMap. Disconnecting.`);
      socket.disconnect(true);
      return;
    }

    // This is the new, fully implemented 'join_voice_channel' handler
    socket.on('join_voice_channel', (channelId: string) => {
      // Check if the user is already in a channel.
      let existingChannelId: string | null = null;
      for (const [key, users] of channelUsers.entries()) {
        if (users.includes(socket.id)) {
          existingChannelId = key;
          break;
        }
      }

      // If the user is in a different channel, make them leave it first.
      if (existingChannelId && existingChannelId !== channelId) {
          console.log(`User ${socket.id} leaving old channel ${existingChannelId} to join new channel ${channelId}`);
          // We can call the leave handler to handle cleanup
          const usersInOldChannel = channelUsers.get(existingChannelId) || [];
          const updatedUsersInOldChannel = usersInOldChannel.filter(id => id !== socket.id);
          channelUsers.set(existingChannelId, updatedUsersInOldChannel);
          voiceStates.delete(socket.id);
          socket.leave(existingChannelId);
          usersInOldChannel.forEach(userSocketId => {
              io.to(userSocketId).emit('user-disconnected', {
                  socketId: socket.id,
                  userId,
                  channelId: existingChannelId
              });
          });
      }


      socket.join(channelId);
      const usersInChannel = channelUsers.get(channelId) || [];

      // Notify all EXISTING users in the channel about the new user
      usersInChannel.forEach(existingUserSocketId => {
        const existingUserId = getUserIdFromSocketId(existingUserSocketId);
        if (existingUserId) {
          io.to(existingUserSocketId).emit('user-joined', {
            socketId: socket.id,
            userId: userId,
            channelId
          });
        }
      });
      
      // Update the channel user list and voice state map for the new user
      channelUsers.set(channelId, [...usersInChannel, socket.id]);
      // Default state for a new user joining
      voiceStates.set(socket.id, { userId, muted: false, speaking: false, video: false }); 

      // Send the 'roster' (list of existing members) to the new user
      const roster = usersInChannel.map(existingSocketId => {
          const state = voiceStates.get(existingSocketId);
          return {
              socketId: existingSocketId,
              userId: state?.userId,
              muted: state?.muted,
              speaking: state?.speaking,
              video: state?.video
          };
      });
      socket.emit('voice_roster', { channelId, members: roster });
    });

    // WebRTC signaling handlers - now sending 'channelId'
    socket.on('webrtc-offer', ({ to, sdp, channelId }) => { // <-- Receive channelId
      if (!channelId || !to) {
        return socket.emit('signaling_error', 'Offer is missing required fields.');
      }
      io.to(to).emit('webrtc-offer', { from: socket.id, sdp, channelId }); // <-- Send channelId
    });

    socket.on('webrtc-answer', ({ to, sdp, channelId }) => { // <-- Receive channelId
      if (!channelId || !to) {
        return socket.emit('signaling_error', 'Answer is missing required fields.');
      }
      io.to(to).emit('webrtc-answer', { from: socket.id, sdp, channelId }); // <-- Send channelId
    });

    socket.on('webrtc-ice-candidate', ({ to, candidate, channelId }) => { // <-- Receive channelId
      if (!channelId || !to) {
        return socket.emit('signaling_error', 'ICE candidate is missing required fields.');
      }
      io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate, channelId }); // <-- Send channelId
    });

    // --- NEW HANDLERS FROM FRONTEND ---

    // Handle when a user leaves the channel
    socket.on('leave_voice_channel', (channelId: string) => {
      console.log(`User ${socket.id} leaving voice channel ${channelId}`);
      socket.leave(channelId);
      const users = channelUsers.get(channelId) || [];
      const updated = users.filter(id => id !== socket.id);
      channelUsers.set(channelId, updated);
      voiceStates.delete(socket.id); // Remove voice state

      // Notify all remaining users that a user has left
      const leavingUserId = getUserIdFromSocketId(socket.id);
      updated.forEach(userIdInChannel => {
        io.to(userIdInChannel).emit('user-disconnected', { 
          socketId: socket.id,
          userId: leavingUserId,
          channelId
        });
      });
    });

    // Handle voice state updates (mute, speaking, video on/off)
    socket.on('voice_state_update', (data: { channelId: string, muted: boolean, speaking: boolean, video: boolean }) => {
      const state = voiceStates.get(socket.id);
      if (state) {
        const newState = { ...state, ...data };
        voiceStates.set(socket.id, newState);
        // Broadcast the state change to everyone else in the channel
        io.to(data.channelId).emit('user_voice_state', {
          socketId: socket.id,
          userId: state.userId,
          ...data,
        });
      }
    });


    // The general disconnect handler.
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      const disconnectedUserId = getUserIdFromSocketId(socket.id);

      // Find the channel the user was in and notify others
      for (const [channelId, users] of channelUsers.entries()) {
        if (users.includes(socket.id)) {
          const updated = users.filter(id => id !== socket.id);
          channelUsers.set(channelId, updated);
          
          voiceStates.delete(socket.id);

          // Emit to the remaining users in that specific channel
          updated.forEach(userIdInChannel => {
            io.to(userIdInChannel).emit('user-disconnected', { 
              socketId: socket.id,
              userId: disconnectedUserId,
              channelId
            });
          });
          break; // Stop the loop since we found the user
        }
      }
    });
  });
}