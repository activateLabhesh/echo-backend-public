import { Response } from 'express';
import { supabase } from '../client/supabase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import multer from 'multer';

export const storage = multer.memoryStorage();
export const upload = multer({ storage });

export const updateProfile = async (req: AuthenticatedRequest, res: Response) => {
  const email = req.userEmail;
  if (!email) {
    return res.status(400).json({ error: 'User email not found in request' });
  }

  const { username, bio } = req.body;
  const avatarFile = req.file;
  // Creating a variable to dynamically update what the user wants to update
  const updateData: { [key: string]: string | undefined } = {};
  if (username) updateData.username = username;
  if (bio) updateData.bio = bio;
  if (avatarFile) {
    const ext = path.extname(avatarFile.originalname);
    const fileName = `${uuidv4()}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, avatarFile.buffer, {
        contentType: avatarFile.mimetype,
        upsert: true
      });

    if (uploadError) {
      return res.status(500).json({ error: 'Image upload failed', detail: uploadError.message });
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
    updateData.avatar_url = publicUrlData?.publicUrl;
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No fields provided for update' });
  }

  const { data, error } = await supabase
    .from('User')
    .update(updateData)
    .eq('email', email)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json({ message: 'Profile updated', user: data?.[0] });
};

export const updateStatus = async (req: AuthenticatedRequest, res: Response) => {
  const email = req.userEmail;
  if (!email) {
    return res.status(400).json({ error: 'User email not found in request' });
  }

  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  const { data, error } = await supabase
    .from('User')
    .update({ status })
    .eq('email', email)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json({ message: 'Status updated', user: data?.[0] });
};
