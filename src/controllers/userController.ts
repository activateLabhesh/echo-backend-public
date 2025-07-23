import { Request, Response } from 'express';
import { supabase } from '../client/supabase';
import jwt from 'jsonwebtoken';

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const { bio, fullname, username } = req.body;
  
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

  if (!bio && !fullname && !username) {
    res.status(400).json({ message: 'At least one field to update is required (bio, fullname, or username)' });
    return;
  }

  let userId: string;
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);
    userId = decoded.sub;
    if (!userId) throw new Error('User ID (sub) missing in token');
    // console.log('User ID from token (sub):', userId);
  } catch (err) {
    console.error('JWT verification failed:', err);
    res.status(401).json({ message: 'Invalid or expired access token' });
    return;
  }

  const updates: any = {};
  if (bio !== undefined) updates.bio = bio;
  if (fullname !== undefined) updates.fullname = fullname;
  if (username !== undefined) updates.username = username;

  const { error: updateError } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId); 

  if (updateError) {
    console.error('Error updating profile:', updateError.message);
    res.status(500).json({ message: 'Failed to update profile' });
    return;
  }

  res.status(200).json({ message: 'Profile updated successfully' });
};
