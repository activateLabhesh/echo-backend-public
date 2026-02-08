/**
 * Redis-backed user -> socketId mapping for cross-instance DM delivery.
 * With multiple backend instances (e.g. ECS), each instance has its own in-memory map.
 * Storing in Redis allows any instance to look up any user's socketId.
 */

import { createClient, RedisClientType } from "redis";

const KEY_PREFIX = "socket:user:";
const DEFAULT_TTL_SEC = 60 * 60 * 2; // 2 hours - refreshed on each connect

let redisClient: RedisClientType | null = null;

async function getClient(): Promise<RedisClientType> {
  if (!redisClient) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required for userSocketStore");
    redisClient = createClient({ url });
    redisClient.on("error", (err) => console.error("[userSocketStore] Redis error:", err));
    await redisClient.connect();
  }
  return redisClient;
}

export async function setUserSocket(userId: string, socketId: string): Promise<void> {
  const client = await getClient();
  const key = `${KEY_PREFIX}${userId}`;
  await client.setEx(key, DEFAULT_TTL_SEC, socketId);
}

export async function getUserSocket(userId: string): Promise<string | null> {
  const client = await getClient();
  const key = `${KEY_PREFIX}${userId}`;
  const val = await client.get(key);
  return val;
}

export async function deleteUserSocket(userId: string): Promise<void> {
  const client = await getClient();
  const key = `${KEY_PREFIX}${userId}`;
  await client.del(key);
}
