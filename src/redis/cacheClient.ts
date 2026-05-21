import Redis from 'ioredis';

let cacheRedisClient: Redis | null = null;

export const getCacheRedisClient = (): Redis => {
  if (!cacheRedisClient) {
    cacheRedisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    cacheRedisClient.on('error', (error) => {
      console.error('[cacheRedisClient] Redis error:', error);
    });
  }

  return cacheRedisClient;
};
