// src/sockets/voiceSocket.ts
import { Server } from 'socket.io';

export function setupVoiceSocket(io: Server) {
  const channelUsers = new Map<string, string[]>();

  io.on('connection', (socket) => {
    socket.on('join_voice_channel', (channelId: string) => {
      socket.join(channelId);
      const users = channelUsers.get(channelId) || [];
      users.forEach(userId => {
        socket.to(userId).emit('user-joined', socket.id);
      });
      channelUsers.set(channelId, [...users, socket.id]);
    });

    socket.on('webrtc-offer', ({ to, sdp }) => {
      io.to(to).emit('webrtc-offer', { from: socket.id, sdp });
    });

    socket.on('webrtc-answer', ({ to, sdp }) => {
      io.to(to).emit('webrtc-answer', { from: socket.id, sdp });
    });

    socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
      io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
    });

    socket.on('disconnect', () => {
      for (const [channelId, users] of channelUsers.entries()) {
        const updated = users.filter(id => id !== socket.id);
        channelUsers.set(channelId, updated);
        users.forEach(userId => {
          io.to(userId).emit('user-disconnected', socket.id);
        });
      }
    });
  });
}
