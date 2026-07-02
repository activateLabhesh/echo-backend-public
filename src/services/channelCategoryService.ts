import * as channelCategoryRepository from '../repositories/channelCategoryRepository';
import { checkMembershipOrOwnership, checkOwnerOrAdmin } from '../controllers/roleController';

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}

const VALID_CHANNEL_TYPES = ['normal', 'read_only', 'role_restricted'];

// ---------- Channel Categories ----------

export async function getAllChannelCategories(serverId: string, userId: string) {
  const isMemberOrOwner = await checkMembershipOrOwnership(userId, serverId);

  if (!isMemberOrOwner) {
    throw new HttpError(403, 'You are not a member of this server');
  }

  return channelCategoryRepository.getChannelCategories(serverId);
}

export async function createChannelCategory(serverId: string, name: string, position: number, userId: string) {
  const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

  if (!isOwner && !isAdmin) {
    throw new HttpError(403, 'You do not have permission to create a channel category');
  }

  let categoryPosition = position;

  if (categoryPosition === undefined) {
    const existingCategories = await channelCategoryRepository.getExistingCategories(serverId);
    categoryPosition = existingCategories && existingCategories.length > 0
      ? existingCategories[0].position + 1
      : 0;
  }

  return channelCategoryRepository.createChannelCategory(serverId, name, categoryPosition);
}

export async function updateChannelCategory(
  serverId: string,
  categoryId: string,
  name: string,
  position: number,
  userId: string
) {
  const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

  if (!isOwner && !isAdmin) {
    throw new HttpError(403, 'Only owners and admins can update channel categories');
  }

  const updateData: { name?: string; position?: number } = {};
  if (name !== undefined) updateData.name = name.trim();
  if (position !== undefined) updateData.position = position;

  if (Object.keys(updateData).length === 0) {
    throw new HttpError(400, 'No update data provided');
  }

  const category = await channelCategoryRepository.updateChannelCategory(serverId, categoryId, updateData);

  if (!category) {
    throw new HttpError(404, 'Category not found');
  }

  return category;
}

export async function deleteChannelCategory(serverId: string, categoryId: string, userId: string) {
  const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

  if (!isOwner && !isAdmin) {
    throw new HttpError(403, 'Only owners and admins can delete channel categories');
  }

  await channelCategoryRepository.deleteChannelCategory(serverId, categoryId);
}

export async function reorderChannelCategories(serverId: string, categoryIds: string[], userId: string) {
  const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

  if (!isOwner && !isAdmin) {
    throw new HttpError(403, 'Only owners and admins can reorder channel categories');
  }

  return channelCategoryRepository.reorderChannelCategories(serverId, categoryIds);
}

export async function reorderChannels(
  serverId: string,
  channels: { id: string; category_id: string | null; position: number }[],
  userId: string
) {
  const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

  if (!isOwner && !isAdmin) {
    throw new HttpError(403, 'Only owners and admins can reorder channels');
  }

  await channelCategoryRepository.reorderChannels(serverId, channels);
}

export async function updateChannel(
  serverId: string,
  channelId: string,
  data: {
    name?: string;
    category_id?: string | null;
    position?: number;
    channel_type?: string;
    allowed_role_ids?: string[];
    moderator_role_ids?: string[];
  },
  userId: string
) {
  const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

  if (!isOwner && !isAdmin) {
    throw new HttpError(403, 'Only owners and admins can update channels');
  }

  const { name, category_id, position, channel_type, allowed_role_ids, moderator_role_ids } = data;

  if (channel_type !== undefined && !VALID_CHANNEL_TYPES.includes(channel_type)) {
    throw new HttpError(400, 'Invalid channel type. Must be: normal, read_only, or role_restricted');
  }

  if (name !== undefined && (!name || name.trim().length === 0)) {
    throw new HttpError(400, 'Channel name cannot be empty');
  }

  if (allowed_role_ids !== undefined && !Array.isArray(allowed_role_ids)) {
    throw new HttpError(400, 'allowed_role_ids must be an array');
  }

  if (moderator_role_ids !== undefined && !Array.isArray(moderator_role_ids)) {
    throw new HttpError(400, 'moderator_role_ids must be an array');
  }

  if (category_id !== undefined && category_id !== null) {
    const exists = await channelCategoryRepository.categoryExists(serverId, category_id);
    if (!exists) {
      throw new HttpError(400, 'Category does not belong to this server or does not exist');
    }
  }

  if (allowed_role_ids !== undefined && allowed_role_ids.length > 0) {
    const roles = await channelCategoryRepository.getRolesByIds(allowed_role_ids);
    const invalidRoles = roles.filter(role => role.server_id !== serverId);
    if (invalidRoles.length > 0 || roles.length !== allowed_role_ids.length) {
      throw new HttpError(400, 'One or more role IDs do not belong to this server or do not exist');
    }
  }

  if (moderator_role_ids !== undefined && moderator_role_ids.length > 0) {
    const modRoles = await channelCategoryRepository.getRolesByIds(moderator_role_ids);
    const invalidModRoles = modRoles.filter(role => role.server_id !== serverId);
    if (invalidModRoles.length > 0 || modRoles.length !== moderator_role_ids.length) {
      throw new HttpError(400, 'One or more moderator role IDs do not belong to this server or do not exist');
    }
  }

  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (category_id !== undefined) updateData.category_id = category_id;
  if (position !== undefined) updateData.position = position;
  if (channel_type !== undefined) updateData.channel_type = channel_type;
  if (allowed_role_ids !== undefined) updateData.allowed_role_ids = allowed_role_ids;
  if (moderator_role_ids !== undefined) updateData.moderator_role_ids = moderator_role_ids;

  if (Object.keys(updateData).length === 0) {
    throw new HttpError(400, 'No update data provided');
  }

  const channel = await channelCategoryRepository.updateChannel(serverId, channelId, updateData);

  if (!channel) {
    throw new HttpError(404, 'Channel not found');
  }

  return channel;
}