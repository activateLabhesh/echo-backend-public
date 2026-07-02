import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import * as channelCategoryService from '../services/channelCategoryService';

function handleError(res: Response, error: any) {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({ error: error.message });
}

// Get all channel categories for a server
export const getChannelCategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const categories = await channelCategoryService.getAllChannelCategories(server_id, userId);

    res.status(200).json(categories || []);
  } catch (error: any) {
    handleError(res, error);
  }
};

// Create channel category (Owner/Admin only)
export const createChannelCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { name, position } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Category name is required' });
      return;
    }

    const category = await channelCategoryService.createChannelCategory(server_id, name, position, userId);

    res.status(201).json(category);
  } catch (error: any) {
    handleError(res, error);
  }
};

// Update channel category (Owner/Admin only)
export const updateChannelCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, category_id } = req.params;
    const { name, position } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const category = await channelCategoryService.updateChannelCategory(server_id, category_id, name, position, userId);

    res.status(200).json(category);
  } catch (error: any) {
    handleError(res, error);
  }
};

// Delete channel category (Owner/Admin only)
export const deleteChannelCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, category_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await channelCategoryService.deleteChannelCategory(server_id, category_id, userId);

    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    handleError(res, error);
  }
};

// Reorder channel categories (Owner/Admin only)
export const reorderChannelCategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { categoryIds } = req.body; // Array of category IDs in desired order
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      res.status(400).json({ error: 'categoryIds must be a non-empty array' });
      return;
    }

    const categories = await channelCategoryService.reorderChannelCategories(server_id, categoryIds, userId);

    res.status(200).json(categories);
  } catch (error: any) {
    handleError(res, error);
  }
};

// Reorder channels within and between categories (Owner/Admin only)
export const reorderChannels = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { channels } = req.body; // Array of { id, category_id, position }
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!Array.isArray(channels) || channels.length === 0) {
      res.status(400).json({ error: 'channels must be a non-empty array' });
      return;
    }

    await channelCategoryService.reorderChannels(server_id, channels, userId);

    res.status(200).json({ message: 'Channels reordered successfully' });
  } catch (error: any) {
    handleError(res, error);
  }
};

// Update a single channel (for moving between categories)
export const updateChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, channel_id } = req.params;
    const {
      name,
      category_id,
      position,
      channel_type,
      allowed_role_ids,
      moderator_role_ids
    } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const channel = await channelCategoryService.updateChannel(
      server_id,
      channel_id,
      { name, category_id, position, channel_type, allowed_role_ids, moderator_role_ids },
      userId
    );

    res.status(200).json(channel);
  } catch (error: any) {
    handleError(res, error);
  }
};