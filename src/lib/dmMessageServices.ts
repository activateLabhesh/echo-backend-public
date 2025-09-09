import { supabase } from '../client/supabase';

// Interface for the data required to save a DM
// It now expects thread_id to be provided directly.
export interface DMmessageData {
  threadId: string; // The pre-formed thread ID
  senderId: string;
  message: string;
  media_url?: string | null;
}

/**
 * Saves a direct message to the database using a pre-existing thread_id.
 * @param data - The message data including the thread_id, sender, and content.
 */
export const saveDMMessage = async (data: DMmessageData) => {
  // 1. Generate a unique ID for the message itself

  // 2. Insert the data into the 'dm_messages' table with the correct fields
  const { data: savedMessage, error } = await supabase
    .from('dm_messages')
    .insert({
      thread_id: data.threadId, // Use the thread_id passed in the data object
      sender_id: data.senderId,
      content: data.message,
      // Use the provided media_url or default to null if it's not present
      media_url: data.media_url || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Database Error:', error);
    throw new Error('Could not save the direct message.');
  }

  return savedMessage;
};