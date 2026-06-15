import { supabase } from '../client/supabase';
import { getIO, userSocketMap } from '../sockets/chatSocket';
import { v4 as uuidv4 } from 'uuid';

export interface MentionMatch {
  type: 'user' | 'everyone';
  value: string;
  userId?: string;
}

export interface ParsedMentions {
  mentions: MentionMatch[];
  processedContent: string;
}

/**
 * Parse mentions from message content
 */
export const parseMentions = (content: string): ParsedMentions => {
  const mentions: MentionMatch[] = [];
  const seenMentions = new Set<string>(); // Track unique mentions
  let processedContent = content;

  // console.log('Parsing mentions from content:', content);

  // Parse all @mentions with regex
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const allMatches = content.matchAll(mentionRegex);
  
  for (const match of allMatches) {
    const mentionValue = match[1];
    
    if (mentionValue === 'everyone') {
      // Only add @everyone mention if we haven't seen it before
      const mentionKey = 'everyone';
      if (!seenMentions.has(mentionKey)) {
        mentions.push({
          type: 'everyone',
          value: 'everyone'
        });
        seenMentions.add(mentionKey);
        // console.log('Found @everyone mention (first occurrence)');
      } else {
        // console.log('Skipping duplicate @everyone mention');
      }
    } else {
      // Only add user mention if we haven't seen this user before
      const mentionKey = `user:${mentionValue}`;
      if (!seenMentions.has(mentionKey)) {
        mentions.push({
          type: 'user',
          value: mentionValue
        });
        seenMentions.add(mentionKey);
        // console.log('Found user mention (first occurrence):', mentionValue);
      } else {
        // console.log('Skipping duplicate user mention:', mentionValue);
      }
    }
  }

  // console.log('Parsed unique mentions:', mentions.length, mentions);

  return {
    mentions,
    processedContent
  };
};

/**
 * Resolve user mentions to actual user IDs
 */
export const resolveMentions = async (mentions: MentionMatch[], channelId: string): Promise<MentionMatch[]> => {
  const resolvedMentions: MentionMatch[] = [];

  for (const mention of mentions) {
    if (mention.type === 'everyone') {
      resolvedMentions.push(mention);
    } else if (mention.type === 'user') {
      try {
        // Find user by username
        const { data: user, error } = await supabase
          .from('users')
          .select('id')
          .eq('username', mention.value)
          .single();

        if (!error && user) {
          // Check if user is in the same server as the channel
          const { data: channel } = await supabase
            .from('channels')
            .select('server_id')
            .eq('id', channelId)
            .single();

          if (channel) {
            const { data: membership } = await supabase
              .from('server_members')
              .select('user_id')
              .eq('user_id', user.id)
              .eq('server_id', channel.server_id)
              .single();

            if (membership) {
              const resolvedMention = {
                ...mention,
                userId: user.id
              };
              resolvedMentions.push(resolvedMention);
            }
          }
        }
      } catch (error) {

      }
    }
  }

  return resolvedMentions;
};

/**
 * Create mention notifications and store mention data
 */
export const processMentions = async (
  messageId: string,
  channelId: string,
  senderId: string,
  content: string,
  mentions: MentionMatch[]
): Promise<void> => {
  try {
    // Get channel and server info
    const { data: channel } = await supabase
      .from('channels')
      .select(`
        name, 
        server_id, 
        servers!inner(name)
      `)
      .eq('id', channelId)
      .single();

    // Get sender info
    const { data: sender } = await supabase
      .from('users')
      .select('username, avatar_url')
      .eq('id', senderId)
      .single();

    if (!channel || !sender) {

      return;
    }

    const serverName = (channel.servers as any)?.name || 'Unknown Server';

    for (const mention of mentions) {
      if (mention.type === 'everyone') {
        // Store a single @everyone mention record
        const { error: mentionError } = await supabase
          .from('message_mentions')
          .insert({
            id: uuidv4(),
            message_id: messageId,
            mention_type: 'everyone',
            mentioned_user_id: null, // null for @everyone
            mentioned_role_id: null,
          });

        if (mentionError) {

          continue;
        }

        // Get all server members for @everyone
        const { data: serverMembers, error: membersError } = await supabase
          .from('server_members')
          .select('user_id')
          .eq('server_id', channel.server_id)
          .neq('user_id', senderId); // Don't notify the sender

        if (membersError || !serverMembers) {

          continue;
        }

        // console.log(`Creating @everyone notifications for ${serverMembers.length} members`);

        // Create notifications for all members
        for (const member of serverMembers) {
          await createNotification({
            userId: member.user_id,
            messageId,
            channelId,
            senderId,
            senderUsername: sender.username,
            senderAvatar: sender.avatar_url,
            content,
            channelName: channel.name,
            serverName: serverName
          });
        }
      } else if (mention.type === 'user' && mention.userId) {
        // Store the user mention record
        const { error: mentionError } = await supabase
          .from('message_mentions')
          .insert({
            id: uuidv4(),
            message_id: messageId,
            mention_type: 'user',
            mentioned_user_id: mention.userId,
            mentioned_role_id: null,
          });

        if (mentionError) {

          continue;
        }

        // Create notification for specific user
        if (mention.userId !== senderId) { // Don't notify yourself
          await createNotification({
            userId: mention.userId,
            messageId,
            channelId,
            senderId,
            senderUsername: sender.username,
            senderAvatar: sender.avatar_url,
            content,
            channelName: channel.name,
            serverName: serverName
          });
        }
      }
    }
  } catch (error) {

  }
};

interface NotificationData {
  userId: string;
  messageId: string;
  channelId: string;
  senderId: string;
  senderUsername: string;
  senderAvatar: string | null;
  content: string;
  channelName: string;
  serverName: string;
}

/**
 * Create a mention notification for a user
 */
const createNotification = async (data: NotificationData): Promise<void> => {
  try {
    // Check if a notification already exists for this user and message
    const { data: existingNotification, error: checkError } = await supabase
      .from('mention_notifications')
      .select('id')
      .eq('user_id', data.userId)
      .eq('message_id', data.messageId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found" error

      return;
    }

    if (existingNotification) {
      // console.log('Notification already exists for user:', data.userId, 'and message:', data.messageId);
      return; // Don't create duplicate
    }

    // Insert notification into database
    const { data: insertedNotification, error } = await supabase
      .from('mention_notifications')
      .insert({
        user_id: data.userId,
        message_id: data.messageId,
        is_read: false
      })
      .select('id')
      .single();

    if (error) {

      return;
    }

    // Send real-time notification via socket
    const io = getIO();
    const userSocketId = userSocketMap.get(data.userId);

    if (userSocketId) {
      // console.log('Sending real-time notification to user:', data.userId);
      io.to(userSocketId).emit('mention_notification', {
        id: insertedNotification.id, // Include the notification ID
        messageId: data.messageId,
        channelId: data.channelId,
        senderId: data.senderId,
        senderUsername: data.senderUsername,
        senderAvatar: data.senderAvatar,
        content: data.content,
        channelName: data.channelName,
        serverName: data.serverName,
        timestamp: new Date().toISOString(),
        type: 'mention'
      });
    } else {
      // console.log('User not online, notification stored in database only');
    }

    // console.log('Notification created successfully for user:', data.userId);
  } catch (error) {

  }
};
