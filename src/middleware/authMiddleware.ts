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
  console.log('=== AUTH MIDDLEWARE HIT ===');
  console.log('URL:', req.url);
  console.log('Method:', req.method);
  
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')){
      token = authHeader.split(' ')[1];
  }
  else if(req.cookies &&req.cookies.access_token){
      token = req.cookies.access_token;
  }  
   
  if (!token) {
    console.log('No token provided');
    res.status(401).json({ message: 'No token provided' });
    return;
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    
    if (!payload.email) {
      console.log('Token missing email');
      res.status(401).json({ message: 'Authentication failed: Token is missing required information.' });
      return;
    }
    
    console.log('Auth successful for user:', payload.sub);
    (req as AuthenticatedRequest).user = payload;
    (req as AuthenticatedRequest).userEmail = payload.email;
    next();
  } catch (err) {
    console.log('Token verification failed:', err);
    res.status(403).json({ message: 'Invalid token' });
    return;
  }
};