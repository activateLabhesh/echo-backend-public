import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { getCacheRedisClient } from '../redis/cacheClient';

const redis = getCacheRedisClient();
const COOLDOWN = 10;

const getSpamProtectionKey = (req: AuthenticatedRequest): string => {
  const userId = req.user?.sub;

  if (userId) {
    return `spam:user:${userId}:${req.path}`;
  }

  return `spam:ip:${req.ip}:${req.originalUrl}`;
};

export const spamProtection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const actionKey = getSpamProtectionKey(authReq);

  try {
    const lockResult = await redis.set(actionKey, '1', 'EX', COOLDOWN, 'NX');

    if (lockResult === null) {
      res.status(429).json({ message: 'Spam detected. Slow down a bit' });
      return;
    }
  } catch (error) {

  }

  next();
}
