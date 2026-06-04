import { Response } from 'express';
import { supabase } from '../client/supabase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { checkMembershipOrOwnership, checkOwnerOrAdmin } from './roleController';

// Get all channel categories for a server
export const getChannelCategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Check if user is member or owner
    const isMemberOrOwner = await checkMembershipOrOwnership(userId, server_id);

    if (!isMemberOrOwner) {
      res.status(403).json({ error: 'You are not a member of this server' });
      return;
    }

    const { data: categories, error } = await supabase
      .from('channel_categories')
      .select('*')
      .eq('server_id', server_id)
      .order('position', { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(categories || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can create channel categories' });
      return;
    }

    // Get the highest position if not provided
    let categoryPosition = position;
    if (categoryPosition === undefined) {
      const { data: existingCategories } = await supabase
        .from('channel_categories')
        .select('position')
        .eq('server_id', server_id)
        .order('position', { ascending: false })
        .limit(1);

      categoryPosition = existingCategories && existingCategories.length > 0
        ? existingCategories[0].position + 1
        : 0;
    }

    const { data: category, error } = await supabase
      .from('channel_categories')
      .insert({
        server_id: server_id,
        name: name.trim(),
        position: categoryPosition
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json(category);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can update channel categories' });
      return;
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (position !== undefined) updateData.position = position;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'No update data provided' });
      return;
    }

    const { data: category, error } = await supabase
      .from('channel_categories')
      .update(updateData)
      .eq('id', category_id)
      .eq('server_id', server_id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    res.status(200).json(category);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can delete channel categories' });
      return;
    }

    // Channels in this category will have their category_id set to NULL (handled by ON DELETE SET NULL)
    const { error } = await supabase
      .from('channel_categories')
      .delete()
      .eq('id', category_id)
      .eq('server_id', server_id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can reorder channel categories' });
      return;
    }

    // Update each category's position
    const updates = categoryIds.map((categoryId: string, index: number) =>
      supabase
        .from('channel_categories')
        .update({ position: index })
        .eq('id', categoryId)
        .eq('server_id', server_id)
    );

    await Promise.all(updates);

    // Fetch and return updated categories
    const { data: categories, error } = await supabase
      .from('channel_categories')
      .select('*')
      .eq('server_id', server_id)
      .order('position', { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(categories);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can reorder channels' });
      return;
    }

    // Update each channel's position and category
    const updates = channels.map((channel: { id: string; category_id: string | null; position: number }) =>
      supabase
        .from('channels')
        .update({ 
          category_id: channel.category_id,
          position: channel.position 
        })
        .eq('id', channel.id)
        .eq('server_id', server_id)
    );

    await Promise.all(updates);

    res.status(200).json({ message: 'Channels reordered successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can update channels' });
      return;
    }

    const validChannelTypes = ['normal', 'read_only', 'role_restricted'];
    if (channel_type !== undefined && !validChannelTypes.includes(channel_type)) {
      res.status(400).json({ error: 'Invalid channel type. Must be: normal, read_only, or role_restricted' });
      return;
    }

    if (name !== undefined && (!name || name.trim().length === 0)) {
      res.status(400).json({ error: 'Channel name cannot be empty' });
      return;
    }

    if (allowed_role_ids !== undefined && !Array.isArray(allowed_role_ids)) {
      res.status(400).json({ error: 'allowed_role_ids must be an array' });
      return;
    }

    if (moderator_role_ids !== undefined && !Array.isArray(moderator_role_ids)) {
      res.status(400).json({ error: 'moderator_role_ids must be an array' });
      return;
    }

    if (category_id !== undefined && category_id !== null) {
      const { data: category, error: categoryError } = await supabase
        .from('channel_categories')
        .select('id')
        .eq('id', category_id)
        .eq('server_id', server_id)
        .maybeSingle();

      if (categoryError) {
        res.status(500).json({ error: categoryError.message });
        return;
      }

      if (!category) {
        res.status(400).json({ error: 'Category does not belong to this server or does not exist' });
        return;
      }
    }

    if (allowed_role_ids !== undefined && allowed_role_ids.length > 0) {
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

    if (moderator_role_ids !== undefined && moderator_role_ids.length > 0) {
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

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (category_id !== undefined) updateData.category_id = category_id;
    if (position !== undefined) updateData.position = position;
    if (channel_type !== undefined) updateData.channel_type = channel_type;
    if (allowed_role_ids !== undefined) updateData.allowed_role_ids = allowed_role_ids;
    if (moderator_role_ids !== undefined) updateData.moderator_role_ids = moderator_role_ids;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'No update data provided' });
      return;
    }

    const { data: channel, error } = await supabase
      .from('channels')
      .update(updateData)
      .eq('id', channel_id)
      .eq('server_id', server_id)
      .select('id, server_id, name, type, is_private, category_id, position, channel_type, allowed_role_ids, moderator_role_ids')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.status(200).json(channel);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
