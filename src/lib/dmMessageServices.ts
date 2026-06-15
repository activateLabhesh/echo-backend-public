import { supabase } from '../client/supabase';
import { extractGifMediaUrl } from './messageMedia';

// Interface for the data required to save a DM
// It now expects thread_id to be provided directly.
export interface DMmessageData {
  threadId: string; // The pre-formed thread ID
  senderId: string;
  message: string;
  media_url?: string | null;
}

const normalizeMediaUrls = (mediaUrl: unknown): string[] => {
  if (typeof mediaUrl !== 'string') return [];

  const trimmed = mediaUrl.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
    } catch {
      return [trimmed];
    }
  }

  return [trimmed];
};

/**
 * Saves a direct message to the database using a pre-existing thread_id.
 * @param data - The message data including the thread_id, sender, and content.
 */
export const saveDMMessage = async (data: DMmessageData) => {
  const gifMediaUrl = extractGifMediaUrl(data.message);
  const message = gifMediaUrl ? '' : data.message;
  const mediaUrl = data.media_url || gifMediaUrl;

  // 1. Generate a unique ID for the message itself

  // 2. Insert the data into the 'dm_messages' table with the correct fields
  const { data: savedMessage, error } = await supabase
    .from('dm_messages')
    .insert({
      thread_id: data.threadId, // Use the thread_id passed in the data object
      sender_id: data.senderId,
      content: message,
      // Use the provided media_url or default to null if it's not present
      media_url: mediaUrl || null,
    })
    .select(`
      *,
      sender:users!sender_id (
        id,
        username,
        avatar_url
      )
    `) // JOIN users table to get sender info for real-time display
    .single();

  if (error) {

    throw new Error('Could not save the direct message.');
  }

  if (mediaUrl) {

  }

  // Flatten sender info for frontend consistency (matches REST API response structure)
  const enrichedMessage = {
    ...savedMessage,
    username: savedMessage.sender?.username || null,
    sender_avatar_url: savedMessage.sender?.avatar_url || null,
    media_urls: normalizeMediaUrls(savedMessage.media_url),
  };

  return enrichedMessage;
};
