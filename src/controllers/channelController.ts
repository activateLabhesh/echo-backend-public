import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { channelService, AppError } from '../services/channelService';

// Re-exported so other controllers (e.g. messages) can still import these directly.
export async function checkChannelAccess(userId: string, channelId: string): Promise<boolean> {
  return channelService.checkChannelAccess(userId, channelId);
}

export async function checkChannelSendPermission(
  userId: string,
  channelId: string
): Promise<{ canSend: boolean; error?: string }> {
  return channelService.checkChannelSendPermission(userId, channelId);
}

function handleError(res: Response, error: unknown, fallbackMessage = 'Internal server error') {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  const err = error as Error;
  res.status(500).json({ error: err?.message || fallbackMessage });
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

    await channelService.setChannelRoleAccess(userId, channel_id, channel_type, allowed_role_ids, moderator_role_ids);

    res.status(200).json({ message: 'Channel permissions updated successfully' });
  } catch (error) {
    handleError(res, error);
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

    const result = await channelService.getChannelRoleAccess(channel_id);
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error);
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

    const result = await channelService.getChannelPermissions(userId, channelId);
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error, 'Server error');
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
    const channels = await channelService.getChannelsWithAccess(userId, server_id);
    res.status(200).json(channels);
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    const err = error as Error;
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

export const createChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, type } = req.body;
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

  try {
    const newChannel = await channelService.createChannel(userId, server_id, req.body);
    res.status(201).json(newChannel);
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ message: error.message, details: error.message });
      return;
    }
    const details = error instanceof Error ? error.message : 'An unknown error occurred.';
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
    const channels = await channelService.getChannels(userId, server_id);
    res.status(200).json(channels);
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    const err = error as Error;
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
    const newMember = await channelService.joinChannel(requestingUserId, serverId, channelId);
    res.status(201).json({
      message: 'Successfully joined the channel.',
      data: newMember,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'An unexpected internal server error occurred.' });
  }
};

export const deleteChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, channel_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await channelService.deleteChannel(userId, server_id, channel_id);
    res.status(200).json({ message: 'Channel deleted successfully' });
  } catch (error) {
    handleError(res, error);
  }
};