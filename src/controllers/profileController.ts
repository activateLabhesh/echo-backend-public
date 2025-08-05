import { Response } from 'express';
import { supabase } from '../client/supabase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { RequestWithBusboy } from '../middleware/busboyMiddleware';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication error, user not found on request.' });
      return;
    }
    const userId = req.user.sub;
    const { username, bio, fullname } = req.body;
    const avatarFile = (req as RequestWithBusboy).busboyFile;
    const updateData: { [key: string]: any } = {};

    if (avatarFile) {
      if (!avatarFile.mimetype.startsWith('image/')) {
        res.status(400).json({ message: 'Invalid file type. Only images are allowed.' });
        return;
      }
      const MAX_SIZE_IN_BYTES = 5 * 1024 * 1024; // 5MB
      if (avatarFile.size > MAX_SIZE_IN_BYTES) {
        res.status(400).json({ message: 'File is too large. Maximum size is 5MB.' });
        return;
      }
    }

    const { data: currentUser, error: fetchError } = await supabase
      .from('users')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    if (fetchError) throw fetchError;

    if (username !== undefined) {
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .neq('id', userId)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingUser) {
        res.status(409).json({ message: 'This username is already taken.' });
        return;
      }
      updateData.username = username;
    }
  
    if (bio !== undefined) updateData.bio = bio;
    if (fullname !== undefined) updateData.fullname = fullname;

    if (avatarFile) {
      const oldAvatarUrl = currentUser?.avatar_url;
      const ext = path.extname(avatarFile.originalname);
      const fileName = `${uuidv4()}${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, avatarFile.buffer, {
          contentType: avatarFile.mimetype,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      updateData.avatar_url = publicUrlData.publicUrl;

      if (oldAvatarUrl) {
        const oldFileName = oldAvatarUrl.split('/').pop();
        if (oldFileName) {
          await supabase.storage.from('avatars').remove([oldFileName]);
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ message: 'No fields provided for update.' });
      return;
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select() 
      .single();
      
    if (updateError) throw updateError;

    res.status(200).json({
      message: 'Profile updated successfully',
      user: updatedUser,
    });

  } catch (error: any) {
    console.error('Error in updateProfile:', error.message);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
};


export const updateStatus = async (req: AuthenticatedRequest, res: Response): Promise <void> => {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication error, user not found on request.' });
    return;
  }
  const userId = req.user.sub;

  const { status } = req.body;
  if (!status) {
    res.status(400).json({ error: 'Status is required' });
    return 
  }

  const { error } = await supabase
    .from('users')
    .update({ status })
    .eq('id', userId)

  if (error) {
   res.status(500).json({ error: error.message });
   return 
  }

  res.status(200).json({ message: 'Status updated successfully'});
};

export const getProfile = async(req: AuthenticatedRequest, res: Response): Promise <void> =>{
  if (!req.user) {
    res.status(401).json({ message: 'Authentication error, user not found on request.' });
    return;
  }

  const userId = req.user.sub;
  try {
    const { data: userDetails, error: fetchError } = await supabase
      .from('users')
      .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching user profile:', fetchError.message); // Log the actual error
      res.status(500).json({ message: 'An internal server error occurred.' });
      return;
    }

    if (!userDetails) {
      res.status(404).json({ message: 'User profile not found.' });
      return;
    }
    
    res.status(200).json({ message: 'Profile details fetched successfully', user: userDetails });

  } catch (error) {
    console.error('Unexpected error in getProfile:', error);
    res.status(500).json({ message: 'An unexpected internal server error occurred.' });
  }
};