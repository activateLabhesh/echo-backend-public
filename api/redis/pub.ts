
import { createClient } from 'redis';

const pub = createClient();

pub.connect().catch(console.error);

export const publishMessage = async (channel: string, message: string) => {
  await pub.publish(channel, message);
};
