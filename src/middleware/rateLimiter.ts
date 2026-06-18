import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { getCacheRedisClient } from '../redis/cacheClient';

const WINDOW_SIZE_IN_SECONDS = 60;
const MAX_REQUESTS = 20;

const redis = getCacheRedisClient();

const getRateLimitKey = (req: AuthenticatedRequest): string => {
  const userId = req.user?.sub;

  if (userId) {
    return `rate_limit:user:${userId}`;
  }

  return `rate_limit:ip:${req.ip}`;
};

export const rateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const key = getRateLimitKey(authReq);

  try {
    const requestCount = await redis.incr(key);

    if (requestCount === 1) {
      await redis.expire(key, WINDOW_SIZE_IN_SECONDS);
    }

    if (requestCount > MAX_REQUESTS) {
      const ttlSeconds = await redis.ttl(key);
      if (ttlSeconds > 0) {
        res.setHeader('Retry-After', ttlSeconds.toString());
      }

      res.status(429).json({ message: 'Rate limit exceeded. Wait for sometime' });
      return;
    }
  } catch (error) {
    console.error('[rateLimiter] Redis unavailable, allowing request:', error);
  }

  next();
};
