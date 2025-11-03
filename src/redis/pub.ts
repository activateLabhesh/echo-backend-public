import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL;
const pub = createClient({ url: redisUrl });

pub.connect().catch(console.error);

export const publishMessage = async (channel: string, message: string) => {
  await pub.publish(channel, message);
};
