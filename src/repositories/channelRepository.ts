import { supabase } from '../client/supabase';

export const channelRepository = {
  async getChannelForAccessCheck(channelId: string) {
    const { data } = await supabase
      .from('channels')
      .select('*, server_id, channel_type, allowed_role_ids')
      .eq('id', channelId)
      .maybeSingle();
    return data;
  },

  async getChannelForSendCheck(channelId: string) {
    const { data } = await supabase
      .from('channels')
      .select('*, server_id, channel_type, allowed_role_ids, moderator_role_ids')
      .eq('id', channelId)
      .maybeSingle();
    return data;
  },

  async getChannelServerId(channelId: string) {
    const { data } = await supabase
      .from('channels')
      .select('server_id')
      .eq('id', channelId)
      .maybeSingle();
    return data;
  },

  async validateRoleIds(roleIds: string[]) {
    const { data, error } = await supabase
      .from('roles')
      .select('id, server_id')
      .in('id', roleIds);
    if (error) throw error;
    return data;
  },

  async updateChannelPermissions(channelId: string, updateData: Record<string, any>) {
    const { error } = await supabase
      .from('channels')
      .update(updateData)
      .eq('id', channelId);
    if (error) throw error;
  },

  async getChannelPermissionsInfo(channelId: string) {
    const { data } = await supabase
      .from('channels')
      .select('server_id, channel_type, allowed_role_ids, moderator_role_ids')
      .eq('id', channelId)
      .maybeSingle();
    return data;
  },

  async getRolesByIds(roleIds: string[]) {
    const { data } = await supabase
      .from('roles')
      .select('id, name, color')
      .in('id', roleIds);
    return data || [];
  },

  async getChannelWithServerAndRoles(channelId: string) {
    const { data } = await supabase
      .from('channels')
      .select('channel_type, allowed_role_ids, moderator_role_ids, server_id, name')
      .eq('id', channelId)
      .single();
    return data;
  },

  async getServerOwner(serverId: string) {
    const { data } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();
    return data;
  },

  async getChannelsWithCategories(serverId: string) {
    const { data, error } = await supabase
      .from('channels')
      .select(`
        id,
        name,
        type,
        channel_type,
        allowed_role_ids,
        moderator_role_ids,
        is_private,
        category_id,
        position,
        channel_categories (
          id,
          name,
          position
        )
      `)
      .eq('server_id', serverId)
      .order('position', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async getServerMembershipCount(userId: string, serverId: string) {
    const { count, error } = await supabase
      .from('server_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('server_id', serverId);

    if (error) throw error;
    return count || 0;
  },

  async getDefaultCategory(serverId: string, name: string) {
    const { data } = await supabase
      .from('channel_categories')
      .select('id')
      .eq('server_id', serverId)
      .eq('name', name)
      .maybeSingle();
    return data;
  },

  async getLastPositionInCategory(serverId: string, categoryId: string | null) {
    const { data } = await supabase
      .from('channels')
      .select('position')
      .eq('server_id', serverId)
      .eq('category_id', categoryId)
      .order('position', { ascending: false })
      .limit(1);
    return data;
  },

  async createChannelViaRpc(params: {
    p_server_id: string;
    p_user_id: string;
    p_channel_name: string;
    p_channel_type: string;
    p_is_private: boolean;
  }) {
    const { data, error } = await supabase.rpc('create_channel_and_add_member', params);
    return { data, error };
  },

  async updateNewChannel(channelId: string, data: Record<string, any>) {
    const { data: updatedChannel, error } = await supabase
      .from('channels')
      .update(data)
      .eq('id', channelId)
      .select('id, name, type, is_private, category_id, position, channel_type, allowed_role_ids, moderator_role_ids')
      .single();
    return { updatedChannel, error };
  },

  async getChannelsBasic(serverId: string) {
    const { data, error } = await supabase
      .from('channels')
      .select('id, name, type, is_private')
      .eq('server_id', serverId);

    if (error) throw error;
    return data || [];
  },

  async getChannelExistsCount(channelId: string, serverId: string) {
    const { count, error } = await supabase
      .from('channels')
      .select('*', { count: 'exact', head: true })
      .eq('id', channelId)
      .eq('server_id', serverId);

    if (error) throw error;
    return count || 0;
  },

  async getChannelMembershipCount(userId: string, channelId: string) {
    const { count, error } = await supabase
      .from('channel_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('channel_id', channelId);

    if (error) throw error;
    return count || 0;
  },

  async insertChannelMember(userId: string, channelId: string) {
    const { data, error } = await supabase
      .from('channel_members')
      .insert({ user_id: userId, channel_id: channelId })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getChannelForDelete(channelId: string, serverId: string) {
    const { data, error } = await supabase
      .from('channels')
      .select('id, server_id')
      .eq('id', channelId)
      .eq('server_id', serverId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async deleteChannelById(channelId: string, serverId: string) {
    const { error } = await supabase
      .from('channels')
      .delete()
      .eq('id', channelId)
      .eq('server_id', serverId);

    if (error) throw error;
  },
};