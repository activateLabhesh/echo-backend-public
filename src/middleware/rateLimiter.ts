//prevents user from making too many requests to the server 

import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const WINDOW_SIZE_IN_SECONDS = 60;
const MAX_REQUESTS = 10;
//10 requests per minute 

export const rateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let key: string | undefined;
  const user = (req as any).user;

  if (!user || !user.userId) {
    key = `rate_limit:ip:${req.ip}`;
  }else{
  key = `rate_limit:user:${user.userId}`;
  }

  try{
  const req_count = await redis.incr(key);
  
  if (req_count === 1) {
    await redis.expire(key, WINDOW_SIZE_IN_SECONDS);
  }

  if (req_count > MAX_REQUESTS) {
    res.status(429).json({ message: 'Rate limit exceeded. Wait for sometime' });
    return
  }

  }catch(err){
    console.error("Redis error:", err);
    res.status(500).json({ message: "Internal server error" });
  }

  next();
};
