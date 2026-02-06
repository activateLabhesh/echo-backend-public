import { supabase } from '../client/supabase'; // Make sure this path is correct
import Crypto from 'crypto'; 
import { parseMentions, resolveMentions, processMentions } from './mentionParser';

// This is the data our function needs to save a message
export interface MessageData {
  content: string;
  channel_id: string;
  sender_id: string;
  media_url?: string | null; // Optional: for files
}

/**
 * Saves a message to the database and processes any mentions.
 * This is our single, reusable function.
 */
export const saveMessage = async (data: MessageData) => {
  const id = Crypto.randomUUID(); // Generate a unique ID for the message 

  // console.log('Saving message:', { id, content: data.content, channel_id: data.channel_id });

  const { data: savedMessage, error } = await supabase
    .from('messages')
    .insert({
      id: id,
      content: data.content,
      channel_id: data.channel_id,
      sender_id: data.sender_id,
      media_url: data.media_url || null, // Handle optional file URL
      is_edited: false,
    })
    .select(`
      *,
      sender:users!sender_id (
        id,
        username,
        avatar_url
      )
    `) // JOIN users table to get sender info for real-time display
    .single(); // We expect just one row back

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Could not save the message.'); // Throw an error if it fails
  }

  // Flatten sender info for frontend consistency (matches REST API response structure)
  const enrichedMessage = {
    ...savedMessage,
    username: savedMessage.sender?.username || null,
    sender_avatar_url: savedMessage.sender?.avatar_url || null,
  };

  // Process mentions in the background
  try {
    const { mentions } = parseMentions(data.content);
    if (mentions.length > 0) {
      // console.log('Found mentions in message:', mentions);
      const resolvedMentions = await resolveMentions(mentions, data.channel_id);
      if (resolvedMentions.length > 0) {
        await processMentions(
          enrichedMessage.id,
          data.channel_id,
          data.sender_id,
          data.content,
          resolvedMentions
        );
      }
    }
  } catch (mentionError) {
    // console.error('Error processing mentions:', mentionError);
    // Don't fail the message save if mention processing fails
  }

  // Return the enriched message object with sender info
  return enrichedMessage;
};