import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { supabase } from '../client/supabase';

export const getMentions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Get user ID from authenticated user or query parameter
    const userId = req.user?.sub || req.query.userId;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    
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
      console.error('Error fetching user notifications:', userError);
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

    const { data: detailedNotifications, error: detailError } = await query
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (detailError) {
      console.error('Error fetching detailed notifications:', detailError);
      // console.error('Error details:', JSON.stringify(detailError, null, 2));
      
      // If the complex query fails, let's try to build the data manually
      // console.log('Falling back to manual data fetching');
      
      try {
        const manualNotifications = [];
        
        for (const notification of userNotifications.slice(0, Number(limit))) {
          // Get message data
          const { data: message } = await supabase
            .from('messages')
            .select('id, content, sender_id, channel_id')
            .eq('id', notification.message_id)
            .single();
          
          let messageData = {
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
                username: 'Unknown User',
                avatar_url: null
              },
              channels: {
                name: 'unknown',
                server_id: null,
                servers: {
                  name: 'Unknown Server'
                }
              }
            }
          };
          
          if (message) {
            // Get sender data
            const { data: sender } = await supabase
              .from('users')
              .select('username, avatar_url')
              .eq('id', message.sender_id)
              .single();
            
            // Get channel data
            const { data: channel } = await supabase
              .from('channels')
              .select('name, server_id')
              .eq('id', message.channel_id)
              .single();
            
            // Get server data
            let serverName = 'Unknown Server';
            if (channel?.server_id) {
              const { data: server } = await supabase
                .from('servers')
                .select('name')
                .eq('id', channel.server_id)
                .single();
              serverName = server?.name || 'Unknown Server';
            }
            
            // Update the message data
            messageData.message = {
              ...messageData.message,
              users: {
                username: sender?.username || 'Unknown User',
                avatar_url: sender?.avatar_url || null
              },
              channels: {
                name: channel?.name || 'unknown',
                server_id: channel?.server_id || null,
                servers: {
                  name: serverName
                }
              }
            };
          }
          
          manualNotifications.push(messageData);
        }
        
        // console.log('Manual data fetch successful, returning', manualNotifications.length, 'notifications');
        res.json(manualNotifications);
        return;
        
      } catch (manualError) {
        console.error('Manual data fetch also failed:', manualError);
        // Final fallback - return basic notifications
        res.json(userNotifications.slice(0, Number(limit)));
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
            username: user?.username || 'Unknown User',
            avatar_url: user?.avatar_url || null
          },
          channels: {
            name: channel?.name || 'unknown',
            server_id: channel?.server_id,
            servers: {
              name: server?.name || 'Unknown Server'
            }
          }
        }
      };
    }) || [];

    // console.log('Sending transformed notifications:', transformedNotifications.length);
    res.json(transformedNotifications);
  } catch (error) {
    console.error('Failed to get mentions:', error);
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
      console.error('Error marking as read:', error);
      throw error;
    }

    // Delete after marking as read
    const { error: deleteError } = await supabase
      .from('mention_notifications')
      .delete()
      .eq('id', mentionId)
      .eq('user_id', userId);
    if (deleteError) {
      console.error('Error deleting notification:', deleteError);
    }

    // console.log('Mention marked as read successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to mark mention as read:', error);
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
      console.error('Error marking all as read:', error);
      throw error;
    }

    // Delete all read notifications for this user
    const { error: deleteAllError } = await supabase
      .from('mention_notifications')
      .delete()
      .eq('user_id', userId)
      .eq('is_read', true);
    if (deleteAllError) {
      console.error('Error deleting all read notifications:', deleteAllError);
    }

    const updatedCount = data?.length || 0;
    // console.log(`Marked ${updatedCount} mentions as read`);
    
    res.json({ 
      success: true, 
      updatedCount,
      markedIds: data?.map(item => item.id) || []
    });
  } catch (error) {
    console.error('Failed to mark all mentions as read:', error);
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
      console.error('Error fetching server members:', membersError);
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
      console.error('Error fetching users:', usersError);
      res.json(results);
      return;
    }

    // console.log(`Found ${users?.length || 0} users`);
    results.users = users || [];

    res.json(results);
  } catch (error) {
    console.error('Failed to search mentionable:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
};
