import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;

interface JwtPayload {
  sub: string;
  id: string; // The user ID from the token
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  userEmail?: string;
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  let token: string | undefined;

  if (req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }
  
  if (!token) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    
    if (!payload.email) {
      res.status(401).json({ message: 'Authentication failed: Token is missing required information.' });
      return;
    }
    
    (req as AuthenticatedRequest).user = payload;
    (req as AuthenticatedRequest).userEmail = payload.email;
    next();
  } catch (err) {
    res.status(403).json({ message: 'Invalid token' });
    return;
  }
};