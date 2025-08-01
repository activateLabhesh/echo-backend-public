import { Response } from 'express';
import { supabase } from '../client/supabase'; 
import { AuthenticatedRequest } from '../middleware/authMiddleware';

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
