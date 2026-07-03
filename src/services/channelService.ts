import { checkMembershipOrOwnership, checkOwnerOrAdmin, getUserRoles } from '../controllers/roleController';
import { channelRepository } from '../repositories/channelRepository';

const VALID_CHANNEL_TYPES = ['normal', 'read_only', 'role_restricted'];

// Thrown by service functions; the controller maps statusCode -> res.status()
export class AppError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isAdmin(userRoles: any[]) {
  return userRoles.some((ur: any) => {
    const roleName = (ur.roles?.name || '').toString().toLowerCase();
    const roleType = (ur.roles?.role_type || '').toString().toLowerCase();
    return ['admin', 'owner'].includes(roleName) || ['admin', 'owner'].includes(roleType);
  });
}

function isModerator(userRoles: any[], moderatorRoleIds: string[]) {
  return userRoles.some((ur: any) => moderatorRoleIds.includes(ur.role_id));
}

async function validateRoleIdsBelongToServer(roleIds: string[], serverId: string, label: string) {
  const roles = await channelRepository.validateRoleIds(roleIds);
  if (!roles) {
    throw new AppError(500, `Failed to validate ${label} IDs`);
  }
  const invalidRoles = roles.filter((role: any) => role.server_id !== serverId);
  if (invalidRoles.length > 0 || roles.length !== roleIds.length) {
    throw new AppError(400, `One or more ${label} IDs do not belong to this server or do not exist`);
  }
}

export const channelService = {
  // Can the user view this channel at all
  async checkChannelAccess(userId: string, channelId: string): Promise<boolean> {
    const channel = await channelRepository.getChannelForAccessCheck(channelId);
    if (!channel) return false;

    const { isOwner, isAdmin: userIsAdmin } = await checkOwnerOrAdmin(userId, channel.server_id);
    if (isOwner || userIsAdmin) return true;

    const userRoles = await getUserRoles(userId, channel.server_id);
    const userRoleIds = userRoles.map((ur: any) => ur.role_id);
    const channelType = channel.channel_type || 'normal';

    if (channelType === 'normal' || channelType === 'read_only') {
      return checkMembershipOrOwnership(userId, channel.server_id);
    }

    if (channelType === 'role_restricted') {
      const allowedRoles = channel.allowed_role_ids || [];
      return allowedRoles.some((roleId: string) => userRoleIds.includes(roleId));
    }

    return false;
  },

  // Can the user send messages in this channel
  async checkChannelSendPermission(userId: string, channelId: string): Promise<{ canSend: boolean; error?: string }> {
    const channel = await channelRepository.getChannelForSendCheck(channelId);
    if (!channel) {
      return { canSend: false, error: 'Channel not found' };
    }

    const { isOwner, isAdmin: userIsAdmin } = await checkOwnerOrAdmin(userId, channel.server_id);
    if (isOwner) return { canSend: true };

    const userRoles = await getUserRoles(userId, channel.server_id);
    const userRoleIds = userRoles.map((ur: any) => ur.role_id);
    const moderator = isModerator(userRoles, channel.moderator_role_ids || []);

    if (userIsAdmin) return { canSend: true };

    const channelType = channel.channel_type || 'normal';

    if (channelType === 'normal') return { canSend: true };

    if (channelType === 'read_only') {
      if (moderator) return { canSend: true };
      return { canSend: false, error: 'Only admins and moderators can send messages in this read-only channel' };
    }

    if (channelType === 'role_restricted') {
      const allowedRoles = channel.allowed_role_ids || [];
      const hasAllowedRole = allowedRoles.some((roleId: string) => userRoleIds.includes(roleId));
      if (hasAllowedRole) return { canSend: true };
      return { canSend: false, error: 'You need specific roles to access this channel' };
    }

    return { canSend: true };
  },

  // Set channel permissions (Owner/Admin only)
  async setChannelRoleAccess(
    userId: string,
    channelId: string,
    channelType: string | undefined,
    allowedRoleIds: string[] | undefined,
    moderatorRoleIds: string[] | undefined
  ): Promise<void> {
    if (channelType && !VALID_CHANNEL_TYPES.includes(channelType)) {
      throw new AppError(400, 'Invalid channel type. Must be: normal, read_only, or role_restricted');
    }

    const channel = await channelRepository.getChannelServerId(channelId);
    if (!channel) {
      throw new AppError(404, 'Channel not found');
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, channel.server_id);
    if (!isOwner && !isAdmin) {
      throw new AppError(403, 'Only owners and admins can manage channel permissions');
    }

    if (allowedRoleIds && Array.isArray(allowedRoleIds) && allowedRoleIds.length > 0) {
      await validateRoleIdsBelongToServer(allowedRoleIds, channel.server_id, 'role');
    }

    if (moderatorRoleIds && Array.isArray(moderatorRoleIds) && moderatorRoleIds.length > 0) {
      await validateRoleIdsBelongToServer(moderatorRoleIds, channel.server_id, 'moderator role');
    }

    const updateData: any = {};
    if (channelType) updateData.channel_type = channelType;
    if (allowedRoleIds !== undefined) updateData.allowed_role_ids = allowedRoleIds || [];
    if (moderatorRoleIds !== undefined) updateData.moderator_role_ids = moderatorRoleIds || [];

    await channelRepository.updateChannelPermissions(channelId, updateData);
  },

  // Get channel permissions (role details)
  async getChannelRoleAccess(channelId: string) {
    const channel = await channelRepository.getChannelPermissionsInfo(channelId);
    if (!channel) {
      throw new AppError(404, 'Channel not found');
    }

    let allowedRoles: any[] = [];
    if (channel.allowed_role_ids && channel.allowed_role_ids.length > 0) {
      allowedRoles = await channelRepository.getRolesByIds(channel.allowed_role_ids);
    }

    let moderatorRoles: any[] = [];
    if (channel.moderator_role_ids && channel.moderator_role_ids.length > 0) {
      moderatorRoles = await channelRepository.getRolesByIds(channel.moderator_role_ids);
    }

    return {
      channel_type: channel.channel_type,
      allowed_roles: allowedRoles,
      moderator_roles: moderatorRoles,
    };
  },

  // Get channel permissions for the current (requesting) user
  async getChannelPermissions(userId: string, channelId: string) {
    const channel = await channelRepository.getChannelWithServerAndRoles(channelId);
    if (!channel) {
      throw new AppError(404, 'Channel not found');
    }

    const server = await channelRepository.getServerOwner(channel.server_id);
    const isOwner = server?.owner_id === userId;

    const userRoles = await getUserRoles(userId, channel.server_id);
    const userRoleIds = userRoles.map((ur: any) => ur.role_id);

    const admin = isAdmin(userRoles);
    const moderator = isModerator(userRoles, channel.moderator_role_ids || []);

    if (isOwner || admin) {
      return {
        channelType: channel.channel_type,
        canView: true,
        canSend: true,
        isAdmin: admin,
        isModerator: moderator,
        isOwner,
      };
    }

    let canView = true;
    let canSend = true;

    if (channel.channel_type === 'role_restricted') {
      canView = (channel.allowed_role_ids || []).some((roleId: string) => userRoleIds.includes(roleId));
    }

    if (channel.channel_type === 'read_only') {
      canSend = moderator;
    } else if (channel.channel_type === 'role_restricted') {
      canSend = (channel.allowed_role_ids || []).some((roleId: string) => userRoleIds.includes(roleId));
    }

    return {
      channelType: channel.channel_type,
      canView,
      canSend,
      isAdmin: admin,
      isModerator: moderator,
      isOwner,
    };
  },

  // Get channels with access filtering for private channels
  async getChannelsWithAccess(userId: string, serverId: string) {
    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

    if (!isOwner) {
      const count = await channelRepository.getServerMembershipCount(userId, serverId);
      if (count === 0) {
        throw new AppError(403, 'You are not a member of this server.');
      }
    }

    const channels = await channelRepository.getChannelsWithCategories(serverId);

    if (isOwner || isAdmin) {
      return channels.map((channel: any) => ({
        ...channel,
        is_private: channel.channel_type === 'role_restricted',
      }));
    }

    const userRoles = await getUserRoles(userId, serverId);
    const userRoleIds = userRoles.map((ur: any) => ur.role_id);

    return channels
      .filter((channel: any) => {
        const channelType = channel.channel_type || 'normal';
        if (channelType === 'normal' || channelType === 'read_only') return true;
        if (channelType === 'role_restricted') {
          const allowedRoles = channel.allowed_role_ids || [];
          return allowedRoles.some((roleId: string) => userRoleIds.includes(roleId));
        }
        return true;
      })
      .map((channel: any) => ({
        ...channel,
        is_private: channel.channel_type === 'role_restricted',
      }));
  },

  async createChannel(
    userId: string,
    serverId: string,
    body: {
      name: string;
      type: string;
      is_private?: boolean;
      category_id?: string;
      position?: number;
      channel_type?: string;
      allowed_role_ids?: string[];
      moderator_role_ids?: string[];
    }
  ) {
    const { name, type, is_private, category_id, position, channel_type, allowed_role_ids, moderator_role_ids } = body;

    if (channel_type && !VALID_CHANNEL_TYPES.includes(channel_type)) {
      throw new AppError(400, 'Invalid channel type. Must be: normal, read_only, or role_restricted');
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);

    if (!isOwner && !isAdmin) {
      throw new AppError(403, 'Only server owners and admins can create channels.');
    }

    if (channel_type && channel_type !== 'normal' && !isOwner && !isAdmin) {
      throw new AppError(403, 'Only owners and admins can create restricted channels.');
    }

    if (allowed_role_ids && Array.isArray(allowed_role_ids) && allowed_role_ids.length > 0) {
      await validateRoleIdsBelongToServer(allowed_role_ids, serverId, 'role');
    }

    if (moderator_role_ids && Array.isArray(moderator_role_ids) && moderator_role_ids.length > 0) {
      await validateRoleIdsBelongToServer(moderator_role_ids, serverId, 'moderator role');
    }

    let finalCategoryId = category_id;
    if (!finalCategoryId) {
      const defaultCategoryName = type === 'voice' ? 'Voice Channels' : 'Text Channels';
      const defaultCategory = await channelRepository.getDefaultCategory(serverId, defaultCategoryName);
      finalCategoryId = defaultCategory?.id || null;
    }

    let finalPosition = position;
    if (finalPosition === undefined) {
      const existingChannels = await channelRepository.getLastPositionInCategory(serverId, finalCategoryId ?? null);
      finalPosition = existingChannels && existingChannels.length > 0 ? existingChannels[0].position + 1 : 0;
    }

    const { data: newChannel, error: rpcError } = await channelRepository.createChannelViaRpc({
      p_server_id: serverId,
      p_user_id: userId,
      p_channel_name: name,
      p_channel_type: type,
      p_is_private: !!is_private,
    });

    if (rpcError) {
      throw new AppError(403, `Error creating channel: ${rpcError.message}`);
    }

    if (newChannel?.[0]?.id) {
      const { updatedChannel } = await channelRepository.updateNewChannel(newChannel[0].id, {
        category_id: finalCategoryId,
        position: finalPosition,
        channel_type: channel_type || 'normal',
        allowed_role_ids: allowed_role_ids || [],
        moderator_role_ids: moderator_role_ids || [],
      });

      return updatedChannel || newChannel[0];
    }

    return newChannel?.[0];
  },

  async getChannels(userId: string, serverId: string) {
    const server = await channelRepository.getServerOwner(serverId);
    const isOwner = server?.owner_id === userId;

    if (!isOwner) {
      const count = await channelRepository.getServerMembershipCount(userId, serverId);
      if (count === 0) {
        throw new AppError(403, 'You are not a member of this server.');
      }
    }

    return channelRepository.getChannelsBasic(serverId);
  },

  async joinChannel(requestingUserId: string, serverId: string, channelId: string) {
    const server = await channelRepository.getServerOwner(serverId);
    const isOwner = server?.owner_id === requestingUserId;

    if (!isOwner) {
      const serverMemberCount = await channelRepository.getServerMembershipCount(requestingUserId, serverId);
      if (serverMemberCount === 0) {
        throw new AppError(403, 'Forbidden. You are not a member of this server.');
      }
    }

    const channelCount = await channelRepository.getChannelExistsCount(channelId, serverId);
    if (channelCount === 0) {
      throw new AppError(404, `Channel with ID ${channelId} not found on this server.`);
    }

    const existingMemberCount = await channelRepository.getChannelMembershipCount(requestingUserId, channelId);
    if (existingMemberCount > 0) {
      throw new AppError(409, 'You are already a member of this channel.');
    }

    return channelRepository.insertChannelMember(requestingUserId, channelId);
  },

  async deleteChannel(userId: string, serverId: string, channelId: string) {
    const channel = await channelRepository.getChannelForDelete(channelId, serverId);
    if (!channel) {
      throw new AppError(404, 'Channel not found');
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, serverId);
    if (!isOwner && !isAdmin) {
      throw new AppError(403, 'Only owners and admins can delete channels');
    }

    await channelRepository.deleteChannelById(channelId, serverId);
  },
};