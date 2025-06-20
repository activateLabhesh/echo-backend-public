//checks for valid token under header or cookies 

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

export interface AuthenticatedRequest extends Request {
  user?: { userId: string; email?: string };
  userEmail?: string;
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  let token: string| undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')){
      token = authHeader.split(' ')[1];
  }
  else if(req.cookies &&req.cookies.access_token){
      token = req.cookies.access_token;
  }
  
  if (!token) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; email?: string };
    (req as AuthenticatedRequest).user = payload;
    (req as AuthenticatedRequest).userEmail = payload.email;
    next();
  } catch (err) {
    res.status(403).json({ message: 'Invalid token' });
    return;
  }
};
