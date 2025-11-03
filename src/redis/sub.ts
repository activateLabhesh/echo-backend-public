import { createClient } from 'redis';
import { Server } from 'socket.io';

const redisUrl = process.env.REDIS_URL;
const sub = createClient({ url: redisUrl });
sub.connect().catch(console.error);

export const subscribeToChannel = (io: Server) => {
  sub.pSubscribe('chat:*', (message: string, channel: string) => {
    const channelId = channel.split(':')[1]; // "chat:abc123" → "abc123"
    const parsedMessage = JSON.parse(message);
    io.to(channelId).emit('chat_message', parsedMessage);
  });
};


