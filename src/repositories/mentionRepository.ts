import { supabase } from '../client/supabase';
import * as MentionTypes from '../types/mentions.type';
import { MentionMessageRecord } from '../types/mentions.type';

export const mentionRepository = {
  async getNotificationsForUser(userId: string): Promise<MentionTypes.MentionNotificationRecord[]> {
    const { data, error } = await supabase
      .from('mention_notifications')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      throw new Error('Failed to fetch mention notifications');
    }

    return (data as MentionTypes.MentionNotificationRecord[]) || [];
  },

  /**
   * Attempts the full nested join query. Returns the raw {data, error} pair
   * (rather than throwing) because the caller has a manual fallback path for
   * when this complex query fails on a given Supabase/PostgREST setup.
   */
  async getDetailedNotifications(
    userId: string,
    unreadOnly: boolean,
    channelId: string | undefined,
    limit: number,
  ) {
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

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    if (channelId) {
      query = query.eq('messages.channel_id', channelId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    return { data, error };
  },

  async getMessagesByIds(messageIds: string[]): Promise<MentionTypes.MentionMessageRecord[]> {
    if (messageIds.length === 0) return [];

    const { data, error } = await supabase
      .from('messages')
      .select('id, content, sender_id, channel_id')
      .in('id', messageIds);

    if (error) {
      throw new Error('Failed to fetch messages for mentions');
    }

    return (data as MentionMessageRecord[]) || [];
  },

  async getUsersByIds(userIds: string[]): Promise<MentionTypes.MentionUserRecord[]> {
    if (userIds.length === 0) return [];

    const { data, error } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .in('id', userIds);

    if (error) {
      throw new Error('Failed to fetch users for mentions');
    }

    return (data as MentionTypes.MentionUserRecord[]) || [];
  },

  async getChannelsByIds(channelIds: string[]): Promise<MentionTypes.MentionChannelRecord[]> {
    if (channelIds.length === 0) return [];

    const { data, error } = await supabase
      .from('channels')
      .select('id, name, server_id')
      .in('id', channelIds);

    if (error) {
      throw new Error('Failed to fetch channels for mentions');
    }

    return (data as MentionTypes.MentionChannelRecord[]) || [];
  },

  async getServersByIds(serverIds: string[]): Promise<MentionTypes.MentionServerRecord[]> {
    if (serverIds.length === 0) return [];

    const { data, error } = await supabase
      .from('servers')
      .select('id, name')
      .in('id', serverIds);

    if (error) {
      throw new Error('Failed to fetch servers for mentions');
    }

    return (data as MentionTypes.MentionServerRecord[]) || [];
  },

  async markAsRead(mentionId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('mention_notifications')
      .update({ is_read: true })
      .eq('id', mentionId)
      .eq('user_id', userId);

    if (error) {
      throw new Error('Failed to mark mention as read');
    }
  },

  async deleteById(mentionId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('mention_notifications')
      .delete()
      .eq('id', mentionId)
      .eq('user_id', userId);

    if (error) {
      // Preserve original behavior: a failed cleanup delete after marking as
      // read is not surfaced to the caller as a request failure.
      return;
    }
  },

  async markAllAsRead(userId: string): Promise<{ id: string }[]> {
    const { data, error } = await supabase
      .from('mention_notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('id');

    if (error) {
      throw new Error('Failed to mark all mentions as read');
    }

    return data || [];
  },

  async deleteAllRead(userId: string): Promise<void> {
    const { error } = await supabase
      .from('mention_notifications')
      .delete()
      .eq('user_id', userId)
      .eq('is_read', true);

    if (error) {
      // Preserve original behavior: cleanup delete failure is ignored.
      return;
    }
  },

  async getServerMembers(
    serverId: string,
    excludeUserId?: string,
  ): Promise<MentionTypes.MentionMemberRecord[]> {
    let query = supabase
      .from('server_members')
      .select('user_id')
      .eq('server_id', serverId);

    if (excludeUserId) {
      query = query.neq('user_id', excludeUserId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch server members');
    }

    return data || [];
  },

  async searchUsersByIds(
    userIds: string[],
    query: string,
    limit: number,
  ): Promise<MentionTypes.MentionableUserRecord[]> {
    if (userIds.length === 0) return [];

    let usersQuery = supabase
      .from('users')
      .select('id, username, avatar_url, fullname')
      .in('id', userIds);

    if (query && query.length > 0) {
      usersQuery = usersQuery.ilike('username', `%${query}%`);
    }

    const { data, error } = await usersQuery.limit(limit);

    if (error) {
      throw new Error('Failed to search mentionable users');
    }

    return data || [];
  },
};