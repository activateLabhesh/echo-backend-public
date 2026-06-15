/**
 * Redis-backed user -> socketId set for cross-instance DM delivery and presence.
 * With multiple backend instances (e.g. ECS), each instance has its own in-memory map.
 * Storing in Redis allows any instance to look up any user's active socket(s).
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
  await client.sAdd(key, socketId);
  await client.expire(key, DEFAULT_TTL_SEC);
}

export async function getUserSocket(userId: string): Promise<string | null> {
  const client = await getClient();
  const key = `${KEY_PREFIX}${userId}`;
  const members = await client.sMembers(key);
  return members[0] || null;
}

export async function getUserSocketCount(userId: string): Promise<number> {
  const client = await getClient();
  const key = `${KEY_PREFIX}${userId}`;
  return client.sCard(key);
}

export async function deleteUserSocket(userId: string, socketId?: string): Promise<number> {
  const client = await getClient();
  const key = `${KEY_PREFIX}${userId}`;

  if (socketId) {
    await client.sRem(key, socketId);
  } else {
    await client.del(key);
    return 0;
  }

  const remaining = await client.sCard(key);
  if (remaining === 0) {
    await client.del(key);
  } else {
    await client.expire(key, DEFAULT_TTL_SEC);
  }

  return remaining;
}
