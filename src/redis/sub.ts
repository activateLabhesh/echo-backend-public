
import { createClient } from 'redis';
import { Server } from 'socket.io';

const sub = createClient();

sub.connect().catch(console.error);

export const subscribeToChannel = (io: Server) => {
  sub.pSubscribe('chat:*', (message, channel) => {
    const channelId = channel.split(':')[1]; // "chat:abc123" → "abc123"
    const parsedMessage = JSON.parse(message);
    io.to(channelId).emit('chat_message', parsedMessage);
  });
};

