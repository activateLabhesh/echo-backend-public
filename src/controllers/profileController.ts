import { Response } from 'express';
import { supabaseAdmin } from '../client/supabase';
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
      const MAX_SIZE_IN_BYTES = 50 * 1024 * 1024; // 5MB
      if (avatarFile.size > MAX_SIZE_IN_BYTES) {
        res.status(400).json({ message: 'File is too large. Maximum size is 5MB.' });
        return;
      }
    }

    const { data: currentUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    if (fetchError) throw fetchError;

    if (username !== undefined) {
      const { data: existingUser, error: checkError } = await supabaseAdmin
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

      const { error: uploadError } = await supabaseAdmin.storage
        .from('avatars')
        .upload(fileName, avatarFile.buffer, {
          contentType: avatarFile.mimetype,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(fileName);
      updateData.avatar_url = publicUrlData.publicUrl;

      if (oldAvatarUrl) {
        const oldFileName = oldAvatarUrl.split('/').pop();
        if (oldFileName) {
          await supabaseAdmin.storage.from('avatars').remove([oldFileName]);
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ message: 'No fields provided for update.' });
      return;
    }

    const { data: updatedUser, error: updateError } = await supabaseAdmin
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
    console.log(error)
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

  const { error } = await supabaseAdmin
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
    const { data: userDetails, error: fetchError } = await supabaseAdmin
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

    res.status(500).json({ message: 'An unexpected internal server error occurred.' });
  }
};

export const getUserProfileById = async(req: AuthenticatedRequest, res: Response): Promise <void> =>{
  if (!req.user) {
    res.status(401).json({ message: 'Authentication error, user not found on request.' });
    return;
  }

  const { userId } = req.params;
  
  if (!userId) {
    res.status(400).json({ message: 'User ID is required.' });
    return;
  }

  try {
    const { data: userDetails, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('id, username, fullname, avatar_url, bio, status, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {

      res.status(500).json({ message: 'An internal server error occurred.' });
      return;
    }

    if (!userDetails) {
      res.status(404).json({ message: 'User profile not found.' });
      return;
    }
    
    res.status(200).json({ message: 'Profile details fetched successfully', user: userDetails });

  } catch (error) {

    res.status(500).json({ message: 'An unexpected internal server error occurred.' });
  }
};

export const deleteProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication error, user not found on request.' });
    return;
  }

  const userId = req.user.sub;
  const userEmail = req.userEmail;
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ message: 'Password is required to delete your profile.' });
    return;
  }

  try {
    const {error : authError} = await supabaseAdmin.auth.signInWithPassword({
      email: userEmail || '',
      password: password
    });

    if (authError) {
      res.status(401).json({ message: 'Authentication failed. Please check your password.' });
      return;
    }

    //if password is correct, proceed to delete the user profile
    const { error: deleteError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteError) {

      res.status(500).json({ message: 'An internal server error occurred.' });
      return;
    }

    res.status(200).json({ message: 'Profile deleted successfully' });

  } catch (error) {

    res.status(500).json({ message: 'An unexpected internal server error occurred.' });
  }
};

export const removeAvatar = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication error, user not found on request.' });
    return;
  }

  const userId = req.user.sub;

  try {
    const { data: currentUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    if (fetchError || !currentUser) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const oldAvatarUrl = currentUser.avatar_url;
    if (!oldAvatarUrl) {
      res.status(400).json({ message: 'No avatar to delete.' });
      return;
    }

    const oldFileName = oldAvatarUrl.split('/').pop(); //extract the file name from the URL

    if (!oldFileName) {
      res.status(400).json({ message: 'Invalid avatar URL.' });
      return;
    }

    if (oldFileName) {

      const { error: removeError } = await supabaseAdmin.storage.from('avatars').remove([oldFileName]);
      if (removeError) {

        res.status(500).json({ message: 'Failed to delete avatar file from storage.' });
        return;
      }
    }

    // update the user's avatar_url to null if storage deletion is successful
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ avatar_url: null })
      .eq('id', userId);

    if (updateError) {

      res.status(500).json({ message: 'Avatar file deleted but failed to update database.' });
      return;
    }

    res.status(200).json({ message: 'Avatar deleted successfully' });

  } catch (error) {

    res.status(500).json({ message: 'An unexpected internal server error occurred.' });
  }
}

