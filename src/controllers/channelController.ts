import { Response } from 'express';
import { supabase } from '../client/supabase'; 
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { checkOwnerOrAdmin } from './roleController';

// Helper function to get user's roles in a server
async function getUserRoles(userId: string, serverId: string) {
  // Step 1: Get ALL user's role IDs (user_roles table doesn't have server_id column)
  const { data: userRoleLinks, error: userRoleError } = await supabase
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId);

  if (userRoleError || !userRoleLinks || userRoleLinks.length === 0) {
    return [];
  }

  const roleIds = userRoleLinks.map(ur => ur.role_id);

  // Step 2: Get role details for those role IDs, filtered by server_id
  const { data: roles, error: rolesError } = await supabase
    .from('roles')
    .select('id, name, role_type, server_id')
    .in('id', roleIds)
    .eq('server_id', serverId);  // Filter by server_id in roles table

  if (rolesError || !roles || roles.length === 0) {
    return [];
  }

  // Step 3: Combine them in the expected format
  const combined = userRoleLinks
    .map(urLink => {
      const role = roles.find(r => r.id === urLink.role_id);
      if (!role) return null;  // Skip if role not in this server
      return {
        role_id: urLink.role_id,
        roles: {
          id: role.id,
          name: role.name,
          role_type: role.role_type,
          server_id: role.server_id
        }
      };
    })
    .filter(r => r !== null);  // Remove nulls

  return combined;
}

// Helper function to check if user is admin/owner
function isAdmin(userRoles: any[]) {
  return userRoles.some((ur: any) => {
    const roleName = (ur.roles?.name || '').toString().toLowerCase();
    const roleType = (ur.roles?.role_type || '').toString().toLowerCase();
    return ['admin', 'owner'].includes(roleName) || ['admin', 'owner'].includes(roleType);
  });
}

// Helper function to check if user is moderator
function isModerator(userRoles: any[], moderatorRoleIds: string[]) {
  return userRoles.some((ur: any) => 
    moderatorRoleIds.includes(ur.role_id)
  );
}

// Helper function to check if user has access to view a channel
export async function checkChannelAccess(userId: string, channelId: string): Promise<boolean> {
  const { data: channel } = await supabase
    .from('channels')
    .select('*, server_id, channel_type, allowed_role_ids')
    .eq('id', channelId)
    .maybeSingle();

  if (!channel) return false;

  // Check if user is server owner (owners can see all channels)
  const { data: server } = await supabase
    .from('servers')
    .select('owner_id')
    .eq('id', channel.server_id)
    .single();

  if (server?.owner_id === userId) return true;

  // Get user's roles in this server
  const userRoles = await getUserRoles(userId, channel.server_id);
  const userRoleIds = userRoles.map((ur: any) => ur.role_id);

  // Admins can always see all channels
  if (isAdmin(userRoles)) return true;

  // Default to 'normal' if channel_type is not set
  const channelType = channel.channel_type || 'normal';

  // For normal and read_only channels, all server members can view
  if (channelType === 'normal' || channelType === 'read_only') {
    const { data: membership } = await supabase
      .from('server_members')
      .select('id')
      .eq('server_id', channel.server_id)
      .eq('user_id', userId)
      .maybeSingle();

    return !!membership;
  }

  // For role_restricted channels, check if user has allowed role
  if (channelType === 'role_restricted') {
    const allowedRoles = channel.allowed_role_ids || [];
    return allowedRoles.some((roleId: string) => userRoleIds.includes(roleId));
  }

  return false;
}

// Helper function to check if user can send messages in a channel
export async function checkChannelSendPermission(userId: string, channelId: string): Promise<{ canSend: boolean; error?: string }> {
  const { data: channel } = await supabase
    .from('channels')
    .select('*, server_id, channel_type, allowed_role_ids, moderator_role_ids')
    .eq('id', channelId)
    .maybeSingle();

  if (!channel) {
    return { canSend: false, error: 'Channel not found' };
  }

  // Check if user is server owner first (owners can always send)
  const { data: server } = await supabase
    .from('servers')
    .select('owner_id')
    .eq('id', channel.server_id)
    .single();

  if (server?.owner_id === userId) {
    return { canSend: true };
  }

  // Get user's roles in this server
  const userRoles = await getUserRoles(userId, channel.server_id);
  const userRoleIds = userRoles.map((ur: any) => ur.role_id);

  const admin = isAdmin(userRoles);
  const moderator = isModerator(userRoles, channel.moderator_role_ids || []);

  // Admins can always send
  if (admin) {
    return { canSend: true };
  }

  const channelType = channel.channel_type || 'normal';

  // Normal channels: everyone can send
  if (channelType === 'normal') {
    return { canSend: true };
  }

  // Read-only channels: only admins, owners, and moderators can send
  if (channelType === 'read_only') {
    if (moderator) {
      return { canSend: true };
    }
    return { 
      canSend: false, 
      error: 'Only admins and moderators can send messages in this read-only channel' 
    };
  }

  // Role-restricted channels: SIMPLE - if you have the allowed role, you can send
  if (channelType === 'role_restricted') {
    const allowedRoles = channel.allowed_role_ids || [];
    const hasAllowedRole = allowedRoles.some((roleId: string) => userRoleIds.includes(roleId));
    
    if (hasAllowedRole) {
      return { canSend: true };
    }
    
    return { 
      canSend: false, 
      error: 'You need specific roles to access this channel' 
    };
  }

  // Default: allow sending (should not reach here, but just in case)
  return { canSend: true };
}

// Set channel permissions (Owner/Admin only)
export const setChannelRoleAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { channel_id } = req.params;
    const { channel_type, allowed_role_ids, moderator_role_ids } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Validate channel_type
    const validChannelTypes = ['normal', 'read_only', 'role_restricted'];
    if (channel_type && !validChannelTypes.includes(channel_type)) {
      res.status(400).json({ error: 'Invalid channel type. Must be: normal, read_only, or role_restricted' });
      return;
    }

    // Get channel and server info
    const { data: channel } = await supabase
      .from('channels')
      .select('server_id')
      .eq('id', channel_id)
      .maybeSingle();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Check if user is owner or admin
    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, channel.server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can manage channel permissions' });
      return;
    }

    // 🔒 SECURITY: Validate that all role IDs belong to the same server
    if (allowed_role_ids && Array.isArray(allowed_role_ids) && allowed_role_ids.length > 0) {
      const { data: allowedRoles, error: roleCheckError } = await supabase
        .from('roles')
        .select('id, server_id')
        .in('id', allowed_role_ids);

      if (roleCheckError || !allowedRoles) {
        res.status(500).json({ error: 'Failed to validate role IDs' });
        return;
      }

      const invalidRoles = allowedRoles.filter(role => role.server_id !== channel.server_id);
      if (invalidRoles.length > 0 || allowedRoles.length !== allowed_role_ids.length) {
        res.status(400).json({ error: 'One or more role IDs do not belong to this server or do not exist' });
        return;
      }
    }

    if (moderator_role_ids && Array.isArray(moderator_role_ids) && moderator_role_ids.length > 0) {
      const { data: modRoles, error: modRoleCheckError } = await supabase
        .from('roles')
        .select('id, server_id')
        .in('id', moderator_role_ids);

      if (modRoleCheckError || !modRoles) {
        res.status(500).json({ error: 'Failed to validate moderator role IDs' });
        return;
      }

      const invalidModRoles = modRoles.filter(role => role.server_id !== channel.server_id);
      if (invalidModRoles.length > 0 || modRoles.length !== moderator_role_ids.length) {
        res.status(400).json({ error: 'One or more moderator role IDs do not belong to this server or do not exist' });
        return;
      }
    }

    // Update channel with new permissions
    const updateData: any = {};
    if (channel_type) updateData.channel_type = channel_type;
    if (allowed_role_ids !== undefined) updateData.allowed_role_ids = allowed_role_ids || [];
    if (moderator_role_ids !== undefined) updateData.moderator_role_ids = moderator_role_ids || [];

    const { error } = await supabase
      .from('channels')
      .update(updateData)
      .eq('id', channel_id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Channel permissions updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get channel permissions
export const getChannelRoleAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { channel_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get channel info
    const { data: channel } = await supabase
      .from('channels')
      .select('server_id, channel_type, allowed_role_ids, moderator_role_ids')
      .eq('id', channel_id)
      .maybeSingle();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Get role details for allowed_role_ids
    let allowedRoles: any[] = [];
    if (channel.allowed_role_ids && channel.allowed_role_ids.length > 0) {
      const { data: rolesData } = await supabase
        .from('roles')
        .select('id, name, color')
        .in('id', channel.allowed_role_ids);
      allowedRoles = rolesData || [];
    }

    // Get role details for moderator_role_ids
    let moderatorRoles: any[] = [];
    if (channel.moderator_role_ids && channel.moderator_role_ids.length > 0) {
      const { data: rolesData } = await supabase
        .from('roles')
        .select('id, name, color')
        .in('id', channel.moderator_role_ids);
      moderatorRoles = rolesData || [];
    }

    res.status(200).json({
      channel_type: channel.channel_type,
      allowed_roles: allowedRoles,
      moderator_roles: moderatorRoles
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get channel permissions for current user
export const getChannelPermissions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: channel } = await supabase
      .from('channels')
      .select('channel_type, allowed_role_ids, moderator_role_ids, server_id, name')
      .eq('id', channelId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Check if user is server owner
    const { data: server } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', channel.server_id)
      .single();

    const isOwner = server?.owner_id === userId;

    const userRoles = await getUserRoles(userId, channel.server_id);
    const userRoleIds = userRoles.map((ur: any) => ur.role_id);

    const admin = isAdmin(userRoles);
    const moderator = isModerator(userRoles, channel.moderator_role_ids || []);

    let canView = true;
    let canSend = true;

    // Owners and admins can always view and send
    if (isOwner || admin) {
      res.status(200).json({
        channelType: channel.channel_type,
        canView: true,
        canSend: true,
        isAdmin: admin,
        isModerator: moderator,
        isOwner: isOwner
      });
      return;
    }

    // Check view permissions
    if (channel.channel_type === 'role_restricted') {
      canView = (channel.allowed_role_ids || []).some((roleId: string) => userRoleIds.includes(roleId));
    }

    // Check send permissions
    if (channel.channel_type === 'read_only') {
      // Read-only: only moderators can send
      canSend = moderator;
    } else if (channel.channel_type === 'role_restricted') {
      // Role-restricted: SIMPLE - if user has allowed role, they can send
      canSend = (channel.allowed_role_ids || []).some((roleId: string) => userRoleIds.includes(roleId));
    }

    res.status(200).json({
      channelType: channel.channel_type,
      canView,
      canSend,
      isAdmin: admin,
      isModerator: moderator,
      isOwner: isOwner
    });
  } catch (error: any) {
    console.error('Error getting channel permissions:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get channels with access filtering for private channels
export const getChannelsWithAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { server_id } = req.params;
  const userId = req.user?.sub;

  if (!server_id) {
    res.status(400).json({ error: 'Server ID is required in the URL.' });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: 'Authentication error: User ID not found in token.' });
    return;
  }

  try {
    // Check if user is owner or admin first
    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    // If not owner, check membership
    if (!isOwner) {
      const { count, error: membershipError } = await supabase
        .from('server_members')
        .select('*', { count: 'exact', head: true }) 
        .eq('user_id', userId)
        .eq('server_id', server_id);

      if (membershipError) throw membershipError;

      if (!count || count === 0) {
        res.status(403).json({ message: 'You are not a member of this server.' });
        return;
      }
    }

    // Get all channels with category information AND permission system
    const { data: channels, error: channelsError } = await supabase
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
      .eq('server_id', server_id)
      .order('position', { ascending: true });

    if (channelsError) {
      throw new Error(`Database error: ${channelsError.message}`);
    }

    // If user is owner or admin, return all channels with is_private flag
    if (isOwner || isAdmin) {
      const channelsWithFlags = channels?.map(channel => ({
        ...channel,
        is_private: channel.channel_type === 'role_restricted'
      })) || [];
      res.status(200).json(channelsWithFlags);
      return;
    }

    // Get user's roles in this server
    const userRoles = await getUserRoles(userId, server_id);
    const userRoleIds = userRoles.map((ur: any) => ur.role_id);

    // Filter channels based on new permission system
    const accessibleChannels = channels?.filter(channel => {
      const channelType = channel.channel_type || 'normal';
      
      // Normal and read_only channels are visible to all members
      if (channelType === 'normal' || channelType === 'read_only') {
        return true;
      }
      
      // role_restricted channels: check if user has allowed role
      if (channelType === 'role_restricted') {
        const allowedRoles = channel.allowed_role_ids || [];
        const hasAccess = allowedRoles.some((roleId: string) => userRoleIds.includes(roleId));
        return hasAccess;
      }

      // Default: show channel
      return true;
    }).map(channel => ({
      ...channel,
      is_private: channel.channel_type === 'role_restricted'
    })) || [];

    res.status(200).json(accessibleChannels);

  } catch (error) {
    const err = error as Error;
    console.error('Error in getChannelsWithAccess controller:', err.message);
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

export const createChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, type, is_private, category_id, position, channel_type, allowed_role_ids, moderator_role_ids } = req.body;
  const { server_id } = req.params;
  const userId = req.user?.sub;

  if (!userId) {
     res.status(401).json({ error: 'Authentication error: User ID not found in token.' });
     return;
  }
  if (!name || !type) {
     res.status(400).json({ error: 'Request body must include name and type.' });
     return;
  }
  if (!server_id) {
    res.status(400).json({ error: 'Server ID is required in the URL parameters.' });
    return;
  }

  // Validate channel_type
  const validChannelTypes = ['normal', 'read_only', 'role_restricted'];
  if (channel_type && !validChannelTypes.includes(channel_type)) {
    res.status(400).json({ error: 'Invalid channel type. Must be: normal, read_only, or role_restricted' });
    return;
  }

  try {
    // Check if user is owner or admin - only they can create channels
    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only server owners and admins can create channels.' });
      return;
    }

    // Only admins can create restricted channels
    if (channel_type && channel_type !== 'normal' && !isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can create restricted channels.' });
      return;
    }

    // 🔒 SECURITY: Validate that all role IDs belong to the same server
    if (allowed_role_ids && Array.isArray(allowed_role_ids) && allowed_role_ids.length > 0) {
      const { data: allowedRoles, error: roleCheckError } = await supabase
        .from('roles')
        .select('id, server_id')
        .in('id', allowed_role_ids);

      if (roleCheckError || !allowedRoles) {
        res.status(500).json({ error: 'Failed to validate role IDs' });
        return;
      }

      const invalidRoles = allowedRoles.filter(role => role.server_id !== server_id);
      if (invalidRoles.length > 0 || allowedRoles.length !== allowed_role_ids.length) {
        res.status(400).json({ error: 'One or more role IDs do not belong to this server or do not exist' });
        return;
      }
    }

    if (moderator_role_ids && Array.isArray(moderator_role_ids) && moderator_role_ids.length > 0) {
      const { data: modRoles, error: modRoleCheckError } = await supabase
        .from('roles')
        .select('id, server_id')
        .in('id', moderator_role_ids);

      if (modRoleCheckError || !modRoles) {
        res.status(500).json({ error: 'Failed to validate moderator role IDs' });
        return;
      }

      const invalidModRoles = modRoles.filter(role => role.server_id !== server_id);
      if (invalidModRoles.length > 0 || modRoles.length !== moderator_role_ids.length) {
        res.status(400).json({ error: 'One or more moderator role IDs do not belong to this server or do not exist' });
        return;
      }
    }

    // Determine category_id: use provided one or find default based on channel type
    let finalCategoryId = category_id;
    if (!finalCategoryId) {
      const defaultCategoryName = type === 'voice' ? 'Voice Channels' : 'Text Channels';
      const { data: defaultCategory } = await supabase
        .from('channel_categories')
        .select('id')
        .eq('server_id', server_id)
        .eq('name', defaultCategoryName)
        .maybeSingle();
      
      finalCategoryId = defaultCategory?.id || null;
    }

    // Determine position: use provided one or get next available position in category
    let finalPosition = position;
    if (finalPosition === undefined) {
      const { data: existingChannels } = await supabase
        .from('channels')
        .select('position')
        .eq('server_id', server_id)
        .eq('category_id', finalCategoryId)
        .order('position', { ascending: false })
        .limit(1);

      finalPosition = existingChannels && existingChannels.length > 0
        ? existingChannels[0].position + 1
        : 0;
    }

    const { data: newChannel, error: rpcError } = await supabase.rpc('create_channel_and_add_member', {
      p_server_id: server_id,
      p_user_id: userId, 
      p_channel_name: name,
      p_channel_type: type,
      p_is_private: is_private,
    });

    if (rpcError) {
      console.error('RPC `create_channel_and_add_member` error:', rpcError);
      res.status(403).json({ message: 'Error creating channel', details: rpcError.message });
      return;
    }

    // Update the channel with category_id, position, and permission fields
    if (newChannel?.[0]?.id) {
      const { data: updatedChannel, error: updateError } = await supabase
        .from('channels')
        .update({ 
          category_id: finalCategoryId,
          position: finalPosition,
          channel_type: channel_type || 'normal',
          allowed_role_ids: allowed_role_ids || [],
          moderator_role_ids: moderator_role_ids || []
        })
        .eq('id', newChannel[0].id)
        .select('id, name, type, is_private, category_id, position, channel_type, allowed_role_ids, moderator_role_ids')
        .single();

      if (updateError) {
        console.error('Error updating channel with category and permissions:', updateError);
      }

      res.status(201).json(updatedChannel || newChannel[0]);
      return;
    }

    res.status(201).json(newChannel?.[0]);

  } catch (err) {
    console.error('Unexpected error in createChannel controller:', err);
    const details = err instanceof Error ? err.message : 'An unknown error occurred.';
    res.status(500).json({ message: 'An unexpected error occurred.', details });
  }
};


export const getChannels = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { server_id } = req.params;
  const userId = req.user?.sub;

  if (!server_id) {
    res.status(400).json({ error: 'Server ID is required in the URL.' });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: 'Authentication error: User ID not found in token.' });
    return;
  }

  try {
    // Check if user is owner first
    const { data: server } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', server_id)
      .single();

    const isOwner = server?.owner_id === userId;

    // If not owner, check membership
    if (!isOwner) {
      const { count, error: membershipError } = await supabase
        .from('server_members')
        .select('*', { count: 'exact', head: true }) 
        .eq('user_id', userId)
        .eq('server_id', server_id);

      if (membershipError) throw membershipError;

      if (!count || count === 0) {
        res.status(403).json({ message: 'You are not a member of this server.' });
        return;
      }
    }

    // --- 2. Fetch Channels ---
    const { data: channels, error: channelsError } = await supabase
      .from('channels')
      .select('id, name, type, is_private')
      .eq('server_id', server_id);

    if (channelsError) {
      throw new Error(`Database error: ${channelsError.message}`);
    }

    res.status(200).json(channels || []);

  } catch (error) {
    const err = error as Error;
    console.error('Error in getChannels controller:', err.message);
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

export const joinChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { serverId } = req.params;
    const { channelId } = req.body;
    const requestingUserId = req.user?.sub;

    if (!requestingUserId) {
        res.status(401).json({ error: 'Authentication failed. User ID not found in token.' });
        return;
    }
    if (!serverId) {
        res.status(400).json({ error: 'Server ID is required in the URL parameters.' });
        return;
    }
    if (!channelId) {
        res.status(400).json({ error: 'Channel ID is required in the request body.' });
        return;
    }

    try {
        // Check if user is owner first
        const { data: server } = await supabase
            .from('servers')
            .select('owner_id')
            .eq('id', serverId)
            .single();

        const isOwner = server?.owner_id === requestingUserId;

        // If not owner, check membership
        if (!isOwner) {
            const { count: serverMemberCount, error: serverMemberError } = await supabase
                .from('server_members')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', requestingUserId)
                .eq('server_id', serverId);

            if (serverMemberError) throw serverMemberError;

            if (!serverMemberCount || serverMemberCount === 0) {
                res.status(403).json({ error: 'Forbidden. You are not a member of this server.' });
                return;
            }
        }

        const { count: channelCount, error: channelError } = await supabase
            .from('channels')
            .select('*', { count: 'exact', head: true })
            .eq('id', channelId)
            .eq('server_id', serverId);

        if (channelError) throw channelError;
        
        if (!channelCount || channelCount === 0) {
            res.status(404).json({ error: `Channel with ID ${channelId} not found on this server.` });
            return;
        }

        const { count: existingMemberCount, error: memberCheckError } = await supabase
            .from('channel_members')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', requestingUserId)
            .eq('channel_id', channelId);

        if (memberCheckError) throw memberCheckError;

        if (existingMemberCount && existingMemberCount > 0) {
            res.status(409).json({ error: 'You are already a member of this channel.' });
            return;
        }

        const { data: newMember, error: joinError } = await supabase
            .from('channel_members')
            .insert({
                user_id: requestingUserId,
                channel_id: channelId
            })
            .select()
            .single();

        if (joinError) {
            throw new Error(`Failed to join channel: ${joinError.message}`);
        }

        res.status(201).json({
            message: 'Successfully joined the channel.',
            data: newMember
        });

    } catch (error) {
        const err = error as Error;
        console.error('Error in joinChannel controller:', err.message);
        res.status(500).json({ error: 'An unexpected internal server error occurred.' });
    }
};
