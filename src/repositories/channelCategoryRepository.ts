import { supabase } from '../client/supabase';

export async function getChannelCategories(serverId: string) {
  const { data: categories, error } = await supabase
    .from('channel_categories')
    .select('*')
    .eq('server_id', serverId)
    .order('position', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return categories;
}

export async function getExistingCategories(serverId: string) {
  const { data: existingCategories, error } = await supabase
    .from('channel_categories')
    .select('position')
    .eq('server_id', serverId)
    .order('position', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return existingCategories;
}

export async function createChannelCategory(serverId: string, name: string, position: number) {
  const { data: category, error } = await supabase
    .from('channel_categories')
    .insert({
      server_id: serverId,
      name: name.trim(),
      position
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error creating channel category: ${error.message}`);
  }

  return category;
}

export async function updateChannelCategory(
  serverId: string,
  categoryId: string,
  data: { name?: string; position?: number }
) {

  const { data: category, error } = await supabase
    .from('channel_categories')
    .update(data)
    .eq('id', categoryId)
    .eq('server_id', serverId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return category;
}

export async function deleteChannelCategory(serverId: string, categoryId: string) {

  const { error } = await supabase
    .from('channel_categories')
    .delete()
    .eq('id', categoryId)
    .eq('server_id', serverId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function reorderChannelCategories(serverId: string, categoryIds: string[]) {
  const updates = categoryIds.map((categoryId, index) =>
    supabase
      .from('channel_categories')
      .update({ position: index })
      .eq('id', categoryId)
      .eq('server_id', serverId)
  );

  const results = await Promise.all(updates);
  const failed = results.find(r => r.error);
  if (failed?.error) {
    throw new Error(failed.error.message);
  }

  return getChannelCategories(serverId);
}

export async function categoryExists(serverId: string, categoryId: string) {
  const { data: category, error } = await supabase
    .from('channel_categories')
    .select('id')
    .eq('id', categoryId)
    .eq('server_id', serverId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return !!category;
}

export async function getRolesByIds(roleIds: string[]) {
  const { data: roles, error } = await supabase
    .from('roles')
    .select('id, server_id')
    .in('id', roleIds);

  if (error || !roles) {
    throw new Error('Failed to validate role IDs');
  }

  return roles;
}

export async function reorderChannels(
  serverId: string,
  channels: { id: string; category_id: string | null; position: number }[]
) {
  const updates = channels.map(channel =>
    supabase
      .from('channels')
      .update({
        category_id: channel.category_id,
        position: channel.position
      })
      .eq('id', channel.id)
      .eq('server_id', serverId)
  );

  const results = await Promise.all(updates);
  const failed = results.find(r => r.error);
  if (failed?.error) {
    throw new Error(failed.error.message);
  }
}

export async function updateChannel(serverId: string, channelId: string, updateData: Record<string, any>) {
  const { data: channel, error } = await supabase
    .from('channels')
    .update(updateData)
    .eq('id', channelId)
    .eq('server_id', serverId)
    .select('id, server_id, name, type, is_private, category_id, position, channel_type, allowed_role_ids, moderator_role_ids')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return channel;
}