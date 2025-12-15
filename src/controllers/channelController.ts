import { Response } from 'express';
import { supabase } from '../client/supabase'; 
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { checkOwnerOrAdmin } from './roleController';

// Helper function to check if user has access to a private channel
export async function checkChannelAccess(userId: string, channelId: string): Promise<boolean> {
  const { data: channel } = await supabase
    .from('channels')
    .select('*, server_id, is_private')
    .eq('id', channelId)
    .maybeSingle();

  if (!channel) return false;

  // Check if user is server owner first (owners can see all channels)
  const { data: server } = await supabase
    .from('servers')
    .select('owner_id')
    .eq('id', channel.server_id)
    .single();

  if (server?.owner_id === userId) return true;

  // Check if user is admin (admins can see all channels)
  const { isAdmin } = await checkOwnerOrAdmin(userId, channel.server_id);
  if (isAdmin) return true;

  // If channel is not private, all server members can access
  if (!channel.is_private) {
    const { data: membership } = await supabase
      .from('server_members')
      .select('id')
      .eq('server_id', channel.server_id)
      .eq('user_id', userId)
      .maybeSingle();

    return !!membership;
  }

  // For private channels, check role access
  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId);

  if (!userRoles || userRoles.length === 0) return false;

  const userRoleIds = userRoles.map(ur => ur.role_id);

  // Check if any of user's roles have access to this channel
  const { data: channelAccess } = await supabase
    .from('channel_role_access')
    .select('id')
    .eq('channel_id', channelId)
    .in('role_id', userRoleIds);

  return !!(channelAccess && channelAccess.length > 0);
}

// Set channel role access (Owner/Admin only)
export const setChannelRoleAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { channel_id } = req.params;
    const { roleIds, isPrivate } = req.body; // roleIds is array of role IDs
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
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
      res.status(403).json({ error: 'Only owners and admins can manage channel access' });
      return;
    }

    // Update channel privacy setting
    await supabase
      .from('channels')
      .update({ is_private: isPrivate })
      .eq('id', channel_id);

    // Remove existing role access
    await supabase
      .from('channel_role_access')
      .delete()
      .eq('channel_id', channel_id);

    // Add new role access if channel is private
    if (isPrivate && roleIds && roleIds.length > 0) {
      const accessRecords = roleIds.map((roleId: string) => ({
        channel_id: channel_id,
        role_id: roleId
      }));

      const { error } = await supabase
        .from('channel_role_access')
        .insert(accessRecords);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
    }

    res.status(200).json({ message: 'Channel access updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get channel role access
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
      .select('server_id, is_private')
      .eq('id', channel_id)
      .maybeSingle();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const { data: access, error } = await supabase
      .from('channel_role_access')
      .select(`
        id,
        role_id,
        roles(id, name, color)
      `)
      .eq('channel_id', channel_id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({
      is_private: channel.is_private,
      allowed_roles: access
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    // Get all channels
    const { data: channels, error: channelsError } = await supabase
      .from('channels')
      .select('id, name, type, is_private')
      .eq('server_id', server_id);

    if (channelsError) {
      throw new Error(`Database error: ${channelsError.message}`);
    }

    // If user is owner or admin, return all channels
    if (isOwner || isAdmin) {
      res.status(200).json(channels || []);
      return;
    }

    // Get user's roles
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select(`
        role_id,
        roles!inner(server_id)
      `)
      .eq('user_id', userId);

    const userRoleIds = userRoles
      ?.filter((ur: any) => ur.roles?.server_id === server_id)
      .map(ur => ur.role_id) || [];

    // Get channel role access for private channels
    const privateChannelIds = channels?.filter(c => c.is_private).map(c => c.id) || [];

    let accessiblePrivateChannelIds: string[] = [];
    
    if (privateChannelIds.length > 0 && userRoleIds.length > 0) {
      const { data: channelAccess } = await supabase
        .from('channel_role_access')
        .select('channel_id')
        .in('channel_id', privateChannelIds)
        .in('role_id', userRoleIds);

      accessiblePrivateChannelIds = [...new Set(channelAccess?.map(ca => ca.channel_id) || [])];
    }

    // Filter channels: include public channels and accessible private channels
    const accessibleChannels = channels?.filter(channel => {
      if (!channel.is_private) return true;
      return accessiblePrivateChannelIds.includes(channel.id);
    }) || [];

    res.status(200).json(accessibleChannels);

  } catch (error) {
    const err = error as Error;
    console.error('Error in getChannelsWithAccess controller:', err.message);
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

export const createChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, type, is_private } = req.body;
  const { server_id } = req.params;
  const userId = req.user?.sub;

  if (!userId) {
     res.status(401).json({ error: 'Authentication error: User ID not found in token.' });
     return;
  }
  if (!name || !type || is_private === undefined) {
     res.status(400).json({ error: 'Request body must include name, type, and is_private.' });
     return;
  }
  if (!server_id) {
    res.status(400).json({ error: 'Server ID is required in the URL parameters.' });
    return;
  }

  try {
    // Check if user is owner or admin - only they can create channels
    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only server owners and admins can create channels.' });
      return;
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
