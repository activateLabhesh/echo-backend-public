import { supabase, supabaseAdmin } from '../client/supabase';
import { Bucket } from '@supabase/storage-js';

// Bucket names
export const BUCKETS = {
  AVATARS: 'avatars',
  SERVER_ICONS: 'server-icons',
  ATTACHMENTS: 'attachments',
} as const;

// S3 Configuration
const S3_CONFIG = {
  accessKey: process.env.SUPABASE_S3_ACCESS_KEY,
  secretKey: process.env.SUPABASE_S3_SECRET_KEY,
  endpoint: process.env.SUPABASE_S3_ENDPOINT,
  region: 'ap-south-1'
};

// Check and create buckets if they don't exist
export const checkBucketConnection = async () => {
  try {

    const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
    
    if (error) {

      return false;
    }
    const existingBuckets = buckets?.map((b: Bucket) => b.name) || [];


    return true;
  } catch (error) {

    return false;
  }
};

// Upload file to bucket
export const uploadFile = async (
  bucket: keyof typeof BUCKETS,
  path: string,
  file: File | Blob,
  options?: { contentType?: string }
) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKETS[bucket])
      .upload(path, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: options?.contentType,
        ...S3_CONFIG
      });

    if (error) throw error;

    // Get public URL for the uploaded file
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKETS[bucket])
      .getPublicUrl(path);

    return { data, publicUrl };
  } catch (error) {

    throw error;
  }
};

// Delete file from bucket
export const deleteFile = async (bucket: keyof typeof BUCKETS, path: string) => {
  try {
    const { error } = await supabase.storage
      .from(BUCKETS[bucket])
      .remove([path]);

    if (error) throw error;
    return true;
  } catch (error) {

    throw error;
  }
};

// Get file URL
export const getFileUrl = (bucket: keyof typeof BUCKETS, path: string) => {
  const { data: { publicUrl } } = supabase.storage
    .from(BUCKETS[bucket])
    .getPublicUrl(path);
  return publicUrl;
}; 