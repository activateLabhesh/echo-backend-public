
import { supabase } from '../client/supabase'; // Make sure this path is correct
import Crypto from 'crypto'; 

// This is the data our function needs to save a message
export interface MessageData {
  content: string;
  channel_id: string;
  sender_id: string;
  media_url?: string | null; // Optional: for files
}

/**
 * Saves a message to the database.
 * This is our single, reusable function.
 */
export const saveMessage = async (data: MessageData) => {
  const id = Crypto.randomUUID(); // Generate a unique ID for the message 

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
    .select() // This tells Supabase to return the row we just created
    .single(); // We expect just one row back

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Could not save the message.'); // Throw an error if it fails
  }

  // Return the complete message object from the database
  return savedMessage;
};