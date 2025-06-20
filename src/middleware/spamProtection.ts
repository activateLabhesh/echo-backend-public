//prevents users from submitting the same action repeatedly in a short period of time

import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const COOLDOWN=10;

export const spamProtection = async (req: Request, res: Response, next: NextFunction):Promise<void> => {
  let actionKey: string | undefined;
  const user = (req as any).user;

  if (!user || !user.userId) {
    actionKey = `spam:ip:${req.ip}:${req.originalUrl}`;
  }else{
  actionKey = `spam:user:${user.userId}:${req.path}`;
  }
  
  try{
  const isSpamming = await redis.get(actionKey); //check if same action have been performed before 

  if (isSpamming) {
    res.status(429).json({ message: 'Spam detected. Slow down a bit' });
    return
  }

  await redis.set(actionKey, '1', 'EX', COOLDOWN); //action key is set to expire in 10 sec
  next(); 
  }catch(err){
    console.error("Redis error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
