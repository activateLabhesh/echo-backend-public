import { Server, Socket } from 'socket.io';

export const setupVoiceSocket = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log('User connected for voice:', socket.id);

    socket.on('join_voice_channel', (channelId: string) => {
      socket.join(channelId);
      console.log(`User ${socket.id} joined voice channel ${channelId}`);
      socket.to(channelId).emit('user-joined', socket.id);
    });

    socket.on('webrtc-offer', ({ to, sdp }: { to: string; sdp: any }) => {
      io.to(to).emit('webrtc-offer', { from: socket.id, sdp });
    });

    socket.on('webrtc-answer', ({ to, sdp }: { to: string; sdp: any }) => {
      io.to(to).emit('webrtc-answer', { from: socket.id, sdp });
    });

    socket.on('webrtc-ice-candidate', ({ to, candidate }: { to: string; candidate: any }) => {
      io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected from voice:', socket.id);
      io.emit('user-disconnected', socket.id);
    });
  });
};
