import { Server, Socket } from 'socket.io';
import { publishMessage } from '../redis/pub';

export const setupChatSocket = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log('User connected for chat:', socket.id);

    socket.on('join_room', (channelId: string) => {
      socket.join(channelId);
      console.log(`User ${socket.id} joined chat room ${channelId}`);
    });

    socket.on('chat_message', async (data: { channelId: string; senderId: string; content: string }) => {
      if (!data.channelId || !data.senderId || !data.content) {
        console.error('Invalid chat message');
        return;
      }
      const message = JSON.stringify(data);
      await publishMessage(`chat:${data.channelId}`, message);
    });
  });
};
