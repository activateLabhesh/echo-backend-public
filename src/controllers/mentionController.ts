import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { supabase } from '../client/supabase';

type MentionNotificationRecord = {
  id: string;
  user_id: string;
  message_id: string;
  is_read: boolean;
  created_at: string;
};

type MentionMessageRecord = {
  id: string;
  content: string | null;
  sender_id: string | null;
  channel_id: string | null;
};

type MentionUserRecord = {
  id?: string;
  username: string | null;
  avatar_url: string | null;
};

type MentionChannelRecord = {
  id?: string;
  name: string | null;
  server_id: string | null;
};

type MentionServerRecord = {
  id?: string;
  name: string | null;
};

function normalizeLimit(limit: unknown): number {
  const parsedLimit = Number(limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return 20;
  }

  return Math.min(parsedLimit, 100);
}

function buildMentionNotificationResponse(
  notification: MentionNotificationRecord,
  message?: MentionMessageRecord | null,
  sender?: MentionUserRecord | null,
  channel?: MentionChannelRecord | null,
  server?: MentionServerRecord | null,
) {
  return {
    id: notification.id,
    user_id: notification.user_id,
    message_id: notification.message_id,
    is_read: notification.is_read,
    created_at: notification.created_at,
    message: {
      id: message?.id,
      content: message?.content || '',
      sender_id: message?.sender_id,
      channel_id: message?.channel_id,
      users: {
        username: sender?.username || 'Unknown User',
        avatar_url: sender?.avatar_url || null,
      },
      channels: {
        name: channel?.name || 'unknown',
        server_id: channel?.server_id || null,
        servers: {
          name: server?.name || 'Unknown Server',
        },
      },
    },
  };
}

async function buildManualMentionNotifications(notifications: MentionNotificationRecord[]) {
  const messageIds = notifications.map((notification) => notification.message_id);

  const { data: messages, error: messageError } = await supabase
    .from('messages')
    .select('id, content, sender_id, channel_id')
    .in('id', messageIds);

  if (messageError) {
    throw messageError;
  }

  const messageMap = new Map<string, MentionMessageRecord>();
  const senderIds = new Set<string>();
  const channelIds = new Set<string>();

  (messages as MentionMessageRecord[] | null)?.forEach((message) => {
    messageMap.set(message.id, message);

    if (message.sender_id) {
      senderIds.add(message.sender_id);
    }

    if (message.channel_id) {
      channelIds.add(message.channel_id);
    }
  });

  const [usersResult, channelsResult] = await Promise.all([
    senderIds.size > 0
      ? supabase.from('users').select('id, username, avatar_url').in('id', Array.from(senderIds))
      : Promise.resolve({ data: [] as MentionUserRecord[], error: null }),
    channelIds.size > 0
      ? supabase.from('channels').select('id, name, server_id').in('id', Array.from(channelIds))
      : Promise.resolve({ data: [] as MentionChannelRecord[], error: null }),
  ]);

  if (usersResult.error) {
    throw usersResult.error;
  }

  if (channelsResult.error) {
    throw channelsResult.error;
  }

  const userMap = new Map<string, MentionUserRecord>();
  (usersResult.data as MentionUserRecord[] | null)?.forEach((user) => {
    if (user.id) {
      userMap.set(user.id, user);
    }
  });

  const channelMap = new Map<string, MentionChannelRecord>();
  const serverIds = new Set<string>();
  (channelsResult.data as MentionChannelRecord[] | null)?.forEach((channel) => {
    if (channel.id) {
      channelMap.set(channel.id, channel);
    }

    if (channel.server_id) {
      serverIds.add(channel.server_id);
    }
  });

  const serverMap = new Map<string, MentionServerRecord>();
  if (serverIds.size > 0) {
    const { data: servers, error: serverError } = await supabase
      .from('servers')
      .select('id, name')
      .in('id', Array.from(serverIds));

    if (serverError) {
      throw serverError;
    }

    (servers as MentionServerRecord[] | null)?.forEach((server) => {
      if (server.id) {
        serverMap.set(server.id, server);
      }
    });
  }

  return notifications.map((notification) => {
    const message = messageMap.get(notification.message_id) || null;
    const sender = message?.sender_id ? userMap.get(message.sender_id) || null : null;
    const channel = message?.channel_id ? channelMap.get(message.channel_id) || null : null;
    const server = channel?.server_id ? serverMap.get(channel.server_id) || null : null;

    return buildMentionNotificationResponse(notification, message, sender, channel, server);
  });
}

export const getMentions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Get user ID from authenticated user or query parameter
    const userId = req.user?.sub || req.query.userId;
    const { page = 1, limit = 20, unreadOnly = false, channelId } = req.query;
    const normalizedLimit = normalizeLimit(limit);
    
    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    // console.log('Getting mentions for user:', userId);
    
    // Check if there are any notifications for this user
    const { data: userNotifications, error: userError } = await supabase
      .from('mention_notifications')
      .select('*')
      .eq('user_id', userId);

    // console.log('Found', userNotifications?.length || 0, 'notifications for user');
    
    if (userError) {

      throw userError;
    }

    // If no notifications for this user, return empty array
    if (!userNotifications || userNotifications.length === 0) {
      // console.log('No notifications found for user, returning empty array');
      res.json([]);
      return;
    }

    // Get the full notification data with proper joins
    // console.log('Fetching detailed notification data...');
    
    let query = supabase
      .from('mention_notifications')
      .select(`
        id,
        user_id,
        message_id,
        is_read,
        created_at,
        messages!inner (
          id,
          content,
          sender_id,
          channel_id,
          users!sender_id (
            username,
            avatar_url
          ),
          channels!channel_id (
            name,
            server_id,
            servers!server_id (
              name
            )
          )
        )
      `)
      .eq('user_id', userId);

    if (unreadOnly === 'true') {
      query = query.eq('is_read', false);
    }

    // Filter by channel if channelId is provided
    if (channelId) {
      query = query.eq('messages.channel_id', channelId);
    }

    const { data: detailedNotifications, error: detailError } = await query
      .order('created_at', { ascending: false })
      .limit(normalizedLimit);

    if (detailError) {

      // console.error('Error details:', JSON.stringify(detailError, null, 2));
      
      // If the complex query fails, let's try to build the data manually
      // console.log('Falling back to manual data fetching');
      
      try {
        const filteredNotifications = (userNotifications as MentionNotificationRecord[])
          .filter((notification) => unreadOnly !== 'true' || !notification.is_read)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, normalizedLimit);

        const manualNotifications = await buildManualMentionNotifications(filteredNotifications);
        const filteredManualNotifications = channelId
          ? manualNotifications.filter((notification) => notification.message.channel_id === channelId)
          : manualNotifications;
        
        // console.log('Manual data fetch successful, returning', manualNotifications.length, 'notifications');
        res.json(filteredManualNotifications);
        return;
        
      } catch (manualError) {

        // Final fallback - return basic notifications
        res.json(userNotifications.slice(0, normalizedLimit));
        return;
      }
    }

    // console.log('Successfully fetched', detailedNotifications?.length || 0, 'detailed notifications');
    
    // Debug: Log the structure of the first notification
    // if (detailedNotifications && detailedNotifications.length > 0) {
    //   console.log('First notification structure:', JSON.stringify(detailedNotifications[0], null, 2));
    // }
    
    // Transform the data to match the expected frontend format
    const transformedNotifications = detailedNotifications?.map(notification => {
      const message = Array.isArray(notification.messages) ? notification.messages[0] : notification.messages;
      const user = Array.isArray(message?.users) ? message.users[0] : message?.users;
      const channel = Array.isArray(message?.channels) ? message.channels[0] : message?.channels;
      const server = Array.isArray(channel?.servers) ? channel.servers[0] : channel?.servers;
      
      // console.log('Transforming notification:', {
      //   messageContent: message?.content,
      //   username: user?.username,
      //   channelName: channel?.name,
      //   serverName: server?.name
      // });
      
      return buildMentionNotificationResponse(notification as MentionNotificationRecord, message, user, channel, server);
    }) || [];

    // console.log('Sending transformed notifications:', transformedNotifications.length);
    res.json(transformedNotifications);
  } catch (error) {

    res.status(500).json({ error: 'Failed to fetch mentions' });
  }
};

export const markMentionAsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { mentionId } = req.params;
    const userId = req.user?.sub || req.query.userId || req.body.userId;

    // console.log('Marking mention as read:', mentionId, 'for user:', userId);

    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    // Mark as read
    const { error } = await supabase
      .from('mention_notifications')
      .update({ is_read: true })
      .eq('id', mentionId)
      .eq('user_id', userId);

    if (error) {

      throw error;
    }

    // Delete after marking as read
    const { error: deleteError } = await supabase
      .from('mention_notifications')
      .delete()
      .eq('id', mentionId)
      .eq('user_id', userId);
    if (deleteError) {

    }

    // console.log('Mention marked as read successfully');
    res.json({ success: true });
  } catch (error) {

    res.status(500).json({ error: 'Failed to update mention' });
  }
};

export const markAllMentionsAsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.sub || req.query.userId || req.body.userId;

    // console.log('Marking all mentions as read for user:', userId);

    if (!userId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    // Mark all unread mentions as read for this user
    const { data, error } = await supabase
      .from('mention_notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('id');

    if (error) {

      throw error;
    }

    // Delete all read notifications for this user
    const { error: deleteAllError } = await supabase
      .from('mention_notifications')
      .delete()
      .eq('user_id', userId)
      .eq('is_read', true);
    if (deleteAllError) {

    }

    const updatedCount = data?.length || 0;
    // console.log(`Marked ${updatedCount} mentions as read`);
    
    res.json({ 
      success: true, 
      updatedCount,
      markedIds: data?.map(item => item.id) || []
    });
  } catch (error) {

    res.status(500).json({ error: 'Failed to update mentions' });
  }
};

export const searchMentionable = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { q, type = 'all' } = req.query;
    const query = typeof q === 'string' ? q : '';
    const userId = req.user?.sub || req.query.userId;

    // console.log(`Searching mentionable - Server: ${serverId}, Query: "${query}", User: ${userId}`);

    const results: any = { users: [] };

    // Step 1: Get all server member user_ids
    let membersQuery = supabase
      .from('server_members')
      .select('user_id')
      .eq('server_id', serverId);
    
    // Exclude current user from server_members directly
    if (userId) {
      membersQuery = membersQuery.neq('user_id', userId);
    }

    const { data: members, error: membersError } = await membersQuery;

    if (membersError) {

      res.json(results);
      return;
    }

    if (!members || members.length === 0) {
      // console.log('No members found in server');
      res.json(results);
      return;
    }

    // Step 2: Get user details for those member IDs
    const memberUserIds = members.map(m => m.user_id);
    
    let usersQuery = supabase
      .from('users')
      .select('id, username, avatar_url, fullname')
      .in('id', memberUserIds);

    // If query is provided, filter by username
    if (query && query.length > 0) {
      usersQuery = usersQuery.ilike('username', `%${query}%`);
    }

    const { data: users, error: usersError } = await usersQuery
      .limit(query && query.length > 0 ? 10 : 15);

    if (usersError) {

      res.json(results);
      return;
    }

    // console.log(`Found ${users?.length || 0} users`);
    results.users = users || [];

    res.json(results);
  } catch (error) {

    res.status(500).json({ error: 'Failed to search' });
  }
};
