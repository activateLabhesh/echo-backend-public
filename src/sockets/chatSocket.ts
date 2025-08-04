import { Server, Socket } from 'socket.io';
import { saveMessage } from '../lib/messageServices'; 

export const setupChatSocket = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log('User connected for chat:', socket.id);

    socket.on('join_room', (channelId: string) => {
      socket.join(channelId);
      console.log(`User ${socket.id} joined chat room ${channelId}`);
    });

    socket.on('send_message', async (data: { channelId: string; senderId: string; message: string }) => {
      // 1. checking the coming data
      if (!data.channelId || !data.senderId || !data.message) {
        console.error('Invalid chat message payload:', data);
        socket.emit('message_error', 'Your message is missing required information.');
        return;
      }
      try {
        // 2. payload from services that we use to save the data..
        const savedMessage = await saveMessage({
          content: data.message,
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

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });
};