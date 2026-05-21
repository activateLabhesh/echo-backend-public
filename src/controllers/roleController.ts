import { Request, Response } from 'express';
import { supabase } from '../client/supabase';
import { getPermissionsByRoleId } from '../middleware/permissionMiddleware';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {v4 as uuidv4} from 'uuid'

const SERVER_ACCESS_CACHE_TTL_MS = 15 * 1000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type ServerRoleAssignment = {
  role_id: string;
  roles: {
    id: string;
    name: string | null;
    role_type: string | null;
    server_id: string;
  };
};

const ownerAdminCache = new Map<string, CacheEntry<{ isOwner: boolean; isAdmin: boolean }>>();
const membershipCache = new Map<string, CacheEntry<boolean>>();
const userRolesCache = new Map<string, CacheEntry<ServerRoleAssignment[]>>();

function getCacheKey(userId: string, serverId: string): string {
  return `${serverId}:${userId}`;
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cachedEntry = cache.get(key);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cachedEntry.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): T {
  cache.set(key, {
    value,
    expiresAt: Date.now() + SERVER_ACCESS_CACHE_TTL_MS,
  });

  return value;
}

async function getServerOwnerId(serverId: string): Promise<string | null> {
  const { data: server } = await supabase
    .from('servers')
    .select('owner_id')
    .eq('id', serverId)
    .single();

  return server?.owner_id ?? null;
}

// Helper function to check if user is owner or admin
export async function checkOwnerOrAdmin(userId: string, serverId: string): Promise<{ isOwner: boolean; isAdmin: boolean }> {
  const cacheKey = getCacheKey(userId, serverId);
  const cachedResult = getCachedValue(ownerAdminCache, cacheKey);

  if (cachedResult) {
    return cachedResult;
  }

  const [ownerId, userRoles] = await Promise.all([
    getServerOwnerId(serverId),
    getUserRoles(userId, serverId),
  ]);

  const isOwner = ownerId === userId;
  const isAdmin = userRoles.some((ur) => {
    const inCorrectServer = ur.roles?.server_id === serverId;
    const roleType = (ur.roles?.role_type || '').toString().toLowerCase();
    const roleName = (ur.roles?.name || '').toString().toLowerCase();
    return inCorrectServer && (
      roleType === 'admin' ||
      roleName === 'admin'
    );
  });

  return setCachedValue(ownerAdminCache, cacheKey, { isOwner, isAdmin });
}

// Helper function to check if user is a member or owner of server
export async function checkMembershipOrOwnership(userId: string, serverId: string): Promise<boolean> {
  const cacheKey = getCacheKey(userId, serverId);
  const cachedResult = getCachedValue(membershipCache, cacheKey);

  if (cachedResult !== null) {
    return cachedResult;
  }

  const ownerId = await getServerOwnerId(serverId);
  if (ownerId === userId) {
    return setCachedValue(membershipCache, cacheKey, true);
  }

  const { data: membership } = await supabase
    .from('server_members')
    .select('user_id')
    .eq('server_id', serverId)
    .eq('user_id', userId)
    .maybeSingle();

  return setCachedValue(membershipCache, cacheKey, !!membership);
}

export async function getUserRoles(userId: string, serverId: string): Promise<ServerRoleAssignment[]> {
  const cacheKey = getCacheKey(userId, serverId);
  const cachedRoles = getCachedValue(userRolesCache, cacheKey);

  if (cachedRoles) {
    return cachedRoles;
  }

  const { data: userRoles, error } = await supabase
    .from('user_roles')
    .select(`
      role_id,
      roles!inner(id, name, role_type, server_id)
    `)
    .eq('user_id', userId)
    .eq('roles.server_id', serverId);

  if (error || !userRoles) {
    return setCachedValue(userRolesCache, cacheKey, []);
  }

  const normalizedRoles = userRoles
    .map((userRole: any) => {
      const role = Array.isArray(userRole.roles) ? userRole.roles[0] : userRole.roles;

      if (!role?.id || !role?.server_id) {
        return null;
      }

      return {
        role_id: userRole.role_id,
        roles: {
          id: role.id,
          name: role.name ?? null,
          role_type: role.role_type ?? null,
          server_id: role.server_id,
        },
      };
    })
    .filter((role): role is ServerRoleAssignment => role !== null);

  return setCachedValue(userRolesCache, cacheKey, normalizedRoles);
}

// Get all roles for a server (any member can view)
export const getAllRoles = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Check if user is member or owner of server
    const isMemberOrOwner = await checkMembershipOrOwnership(userId, server_id);

    if (!isMemberOrOwner) {
      res.status(403).json({ error: 'You are not a member of this server' });
      return;
    }

    const { data: roles, error } = await supabase
      .from('roles')
      .select(`
        *,
        role_categories(id, name, description)
      `)
      .eq('server_id', server_id)
      .order('position', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(roles);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get self-assignable roles for a server
export const getSelfAssignableRoles = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

    // Get self-assignable roles with categories
    const { data: roles, error } = await supabase
      .from('roles')
      .select(`
        *,
        role_categories(id, name, description)
      `)
      .eq('server_id', server_id)
      .eq('is_self_assignable', true)
      .order('position', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Get user's current roles
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role_id')
      .eq('user_id', userId);

    const userRoleIds = userRoles?.map(ur => ur.role_id) || [];

    // Mark which roles user currently has
    const rolesWithStatus = roles?.map(role => ({
      ...role,
      has_role: userRoleIds.includes(role.id)
    }));

    res.status(200).json(rolesWithStatus);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Self-assign a role
export const selfAssignRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { roleId } = req.body;
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

    // Check if role is self-assignable
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .eq('server_id', server_id)
      .eq('is_self_assignable', true)
      .maybeSingle();

    if (roleError || !role) {
      res.status(404).json({ error: 'Self-assignable role not found' });
      return;
    }

    // Assign role
    const { error } = await supabase
      .from('user_roles')
      .insert({
        user_id: userId,
        role_id: roleId
      });

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ error: 'You already have this role' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Role assigned successfully', role });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Self-unassign a role
export const selfUnassignRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { roleId } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Check if role is self-assignable
    const { data: role } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .eq('server_id', server_id)
      .eq('is_self_assignable', true)
      .maybeSingle();

    if (!role) {
      res.status(404).json({ error: 'Self-assignable role not found' });
      return;
    }

    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Role removed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get user's roles in a server
export const getUserRolesInServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: userRoles, error } = await supabase
      .from('user_roles')
      .select(`
        role_id,
        roles!inner(
          id,
          name,
          color,
          position,
          role_type,
          is_self_assignable,
          server_id
        )
      `)
      .eq('user_id', userId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Filter roles for this server
    const roles = userRoles
      ?.filter((ur: any) => ur.roles?.server_id === server_id)
      .map((ur: any) => ur.roles) || [];

    res.status(200).json(roles);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Create a new role (Owner/Admin only)
export const createNewRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { name, color, position, is_self_assignable, category_id } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can create roles' });
      return;
    }

    // Get the highest position to place new role after
    const { data: highestRole } = await supabase
      .from('roles')
      .select('position')
      .eq('server_id', server_id)
      .order('position', { ascending: false })
      .limit(1)
      .single();

    const newPosition = position ?? ((highestRole?.position ?? 0) + 1);

    const { data: role, error } = await supabase
      .from('roles')
      .insert({
        server_id: server_id,
        name,
        color: color || '#99AAB5',
        position: newPosition,
        role_type: is_self_assignable ? 'self_assignable' : 'custom',
        is_self_assignable: is_self_assignable || false,
        category_id: category_id || null
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json(role);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Update a role (Owner/Admin only)
export const updateExistingRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, role_id } = req.params;
    const { name, color, position, is_self_assignable, category_id } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can update roles' });
      return;
    }

    // Check if role is owner or admin type (only owner can modify these)
    const { data: roleData } = await supabase
      .from('roles')
      .select('role_type')
      .eq('id', role_id)
      .single();

    if (roleData?.role_type === 'owner' || roleData?.role_type === 'admin') {
      if (!isOwner) {
        res.status(403).json({ error: 'Only the owner can modify owner/admin roles' });
        return;
      }
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (color !== undefined) updateData.color = color;
    if (position !== undefined) updateData.position = position;
    if (is_self_assignable !== undefined) {
      updateData.is_self_assignable = is_self_assignable;
      // Only change role_type for custom roles
      if (roleData?.role_type !== 'owner' && roleData?.role_type !== 'admin') {
        updateData.role_type = is_self_assignable ? 'self_assignable' : 'custom';
      }
    }
    if (category_id !== undefined) updateData.category_id = category_id;

    const { data: role, error } = await supabase
      .from('roles')
      .update(updateData)
      .eq('id', role_id)
      .eq('server_id', server_id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(role);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a role (Owner/Admin only, but only owner can delete owner/admin roles)
export const deleteExistingRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, role_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can delete roles' });
      return;
    }

    // Check if role is owner or admin type
    const { data: roleData } = await supabase
      .from('roles')
      .select('role_type, name')
      .eq('id', role_id)
      .single();

    if (roleData?.role_type === 'owner') {
      res.status(403).json({ error: 'Cannot delete the owner role' });
      return;
    }

    if (roleData?.role_type === 'admin' && !isOwner) {
      res.status(403).json({ error: 'Only the owner can delete the admin role' });
      return;
    }

    const { error } = await supabase
      .from('roles')
      .delete()
      .eq('id', role_id)
      .eq('server_id', server_id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Role deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Assign role to another user (Owner/Admin only)
export const assignRoleToUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { userId: targetUserId, roleId } = req.body;
    const requestingUserId = req.user?.sub;

    if (!requestingUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(requestingUserId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can assign roles' });
      return;
    }

    // Check if role exists and belongs to this server
    const { data: role } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .eq('server_id', server_id)
      .maybeSingle();

    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    // Prevent assigning owner role - there can only be ONE owner per server
    if (role.role_type === 'owner') {
      res.status(403).json({ error: 'Cannot assign owner role. There can only be one owner per server. Use ownership transfer instead.' });
      return;
    }

    // Only owner can assign admin roles
    if (role.role_type === 'admin' && !isOwner) {
      res.status(403).json({ error: 'Only the owner can assign admin roles' });
      return;
    }

    // Check if target user is member of server
    const { data: targetMember } = await supabase
      .from('server_members')
      .select('user_id')
      .eq('server_id', server_id)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (!targetMember) {
      res.status(404).json({ error: 'User is not a member of this server' });
      return;
    }

    // Assign role
    const { error } = await supabase
      .from('user_roles')
      .insert({
        user_id: targetUserId,
        role_id: roleId
      });

    if (error) {
      if (error.code === '23505') {
        res.status(400).json({ error: 'User already has this role' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Role assigned successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Remove role from another user (Owner/Admin only)
export const removeRoleFromMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { userId: targetUserId, roleId } = req.body;
    const requestingUserId = req.user?.sub;

    if (!requestingUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(requestingUserId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can remove roles' });
      return;
    }

    // Check if role exists
    const { data: role } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .eq('server_id', server_id)
      .maybeSingle();

    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    // Only owner can remove owner/admin roles
    if ((role.role_type === 'owner' || role.role_type === 'admin') && !isOwner) {
      res.status(403).json({ error: 'Only the owner can remove owner/admin roles' });
      return;
    }

    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', targetUserId)
      .eq('role_id', roleId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Role removed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get all role categories for a server
export const getRoleCategories = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
      .from('role_categories')
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

// Create role category (Owner/Admin only)
export const createRoleCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { name, description, position } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can create role categories' });
      return;
    }

    const { data: category, error } = await supabase
      .from('role_categories')
      .insert({
        server_id: server_id,
        name,
        description: description || null,
        position: position || 0
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

// Update role category (Owner/Admin only)
export const updateRoleCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, category_id } = req.params;
    const { name, description, position } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can update role categories' });
      return;
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (position !== undefined) updateData.position = position;

    const { data: category, error } = await supabase
      .from('role_categories')
      .update(updateData)
      .eq('id', category_id)
      .eq('server_id', server_id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json(category);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Delete role category (Owner/Admin only)
export const deleteRoleCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, category_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isOwner, isAdmin } = await checkOwnerOrAdmin(userId, server_id);

    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Only owners and admins can delete role categories' });
      return;
    }

    const { error } = await supabase
      .from('role_categories')
      .delete()
      .eq('id', category_id)
      .eq('server_id', server_id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ message: 'Role category deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

type Role = {
  id: string;
  name: string;
  color: string;
  position: number;
  server_id: string
}; 

export const getRoleDetailsWithPermissions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { username } = req.body;
    const { server_id } = req.params;

    if (!server_id) {
        res.status(400).json({ error: 'ServerId is required.' });
        return;
    }
    if (!username) {
        res.status(400).json({ error: 'Username is required.' });
        return;
    }

    try {
        const { data: targetUserData, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (userError || !targetUserData) {
            res.status(404).json({ error: `User with username "${username}" not found.` });
            return;
        }
        const targetUserId = targetUserData.id;

        const { data: userRolesOnServer, error: rolesError } = await supabase
            .from('user_roles')
            .select(`
                role_id,
                roles!inner(
                    id,
                    name,
                    color,
                    position,
                    server_id,
                    permissions(*)
                )
            `)
            .eq('user_id', targetUserId)
            .eq('roles.server_id', server_id);

        if (rolesError) {
            throw new Error(`Error fetching roles: ${rolesError.message}`);
        }

        if (!userRolesOnServer || userRolesOnServer.length === 0) {
            res.status(404).json({ error: `User "${username}" has no roles on this server.` });
            return;
        }

        res.status(200).json(userRolesOnServer);

    } catch (error) {
        const err = error as Error;
        console.error('FINAL CATCH BLOCK - Error in getRoleDetailsWithPermissions:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export interface RolePermissions{
    "can_manage_server": boolean,
    "can_kick_members": boolean,
    "can_manage_channels": boolean,
    "can_send_messages": boolean,
    "can_connect_voice": boolean}

export const addRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const serverId = req.params.server_id;
    const email_Id = req.user?.email;

    const { name, permissions, color } = req.body as {
        name: string;
        permissions: RolePermissions;
        color?: string;
    };

    // --- Input Validation ---
    if (!serverId || !name || !permissions || !email_Id) {
        res.status(400).json({ error: 'Missing required fields: serverId, name, permissions, and user email are required.' });
        return;
    }

    try {
        // --- Step 1: Get User ID ---
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id')
            .ilike('email', email_Id)
            .single();

        if (userError || !userData) {
            res.status(404).json({ error: `User with email ${email_Id} not found.` });
            return;
        }
        const user_Id = userData.id;

        // --- Step 2: MANUAL VALIDATION - Check user permissions ---
        // First, get all role IDs associated with the user.
        const { data: userRoles, error: rolesError } = await supabase
            .from('user_roles')
            .select('role_id')
            .eq('user_id', user_Id);

        if (rolesError) throw rolesError;

        // If the user has no roles, they can't have permissions.
        if (!userRoles || userRoles.length === 0) {
            res.status(403).json({ message: 'You do not have permission to manage the server.' });
            return;
        }

        // Extract the role IDs into a simple array.
        const roleIds = userRoles.map(r => r.role_id);

        // Now, check if any of those roles have the required permission.
        const { data: userPerms, error: permError } = await supabase
            .from('permissions')
            .select('can_manage_server')
            .in('role_id', roleIds) // Use the array of role IDs here
            .eq('can_manage_server', true)
            .limit(1)
            .single();
        
        if (permError || !userPerms) {
            res.status(403).json({ message: 'You do not have permission to manage the server.' });
            return;
        }

        // --- Step 3: MANUAL VALIDATION - Check for existing role name ---
        const { data: existingRole, error: checkError } = await supabase
            .from('roles')
            .select('id', { count: 'exact', head: true })
            .eq('server_id', serverId)
            .ilike('name', name);

        if (checkError) throw checkError;
        // The count is returned in the 'count' property of the response, not the data property.
        if (existingRole) {
            res.status(409).json({ error: `A role with the name "${name}" already exists.` });
            return;
        }

        // --- Step 4: MANUAL VALIDATION - Determine role position ---
        const { data: lastRole, error: positionError } = await supabase
            .from('roles')
            .select('position')
            .eq('server_id', serverId)
            .order('position', { ascending: false })
            .limit(1)
            .single();

        if (positionError && positionError.code !== 'PGRST116') throw positionError;
        const newPosition = lastRole ? lastRole.position + 1 : 0;

        // --- Step 5: Call the simple batch insert function ---
        const { data: newRole, error: rpcError } = await supabase.rpc('batch_create_role_and_permissions', {
            p_server_id: serverId,
            p_role_name: name,
            p_color: color || '#99AAB5',
            p_position: newPosition,
            p_can_manage_server: permissions.can_manage_server,
            p_can_kick_members: permissions.can_kick_members,
            p_can_manage_channels: permissions.can_manage_channels,
            p_can_send_messages: permissions.can_send_messages,
            p_can_connect_voice: permissions.can_connect_voice,
        });

        if (rpcError) throw rpcError;

        res.status(201).json(newRole?.[0]);

    } catch (error) {
        const err = error as Error;
        console.error('Error in addRole controller:', err.message);
        res.status(500).json({ error: 'An unexpected internal server error occurred.', details: err.message });
    }
};

export const editRole = async(req:AuthenticatedRequest, res:Response): Promise<void>=>{
    const serverId = req.params.server_id;
    const roleId = req.params.role_id;
    const email_Id = req.user?.email;
    const { new_name, new_color } = req.body as {
        new_name?: string;
        new_color?: string;
    };

    // --- Input Validation ---
    if (!serverId || !roleId) {
        res.status(400).json({ error: 'Server ID and Role ID are required in the URL parameters.' });
        return;
    }
     if (!email_Id) {
        res.status(401).json({ error: 'Authentication error: User email not found.' });
        return;
    }

    try {
        // --- Step 1: Get User ID ---
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id')
            .ilike('email', email_Id)
            .single();

        if (userError || !userData) {
            res.status(404).json({ error: `User with email ${email_Id} not found.` });
            return;
        }
        const user_Id = userData.id;

        // --- Step 2: SECURE VALIDATION - Check user permissions ---
        const { data: userRoles, error: rolesError } = await supabase
            .from('user_roles')
            .select('role_id')
            .eq('user_id', user_Id);

        if (rolesError) throw rolesError;
        if (!userRoles || userRoles.length === 0) {
            res.status(403).json({ error: 'You do not have permission to edit roles on this server.' });
            return;
        }
        const roleIds = userRoles.map(r => r.role_id);
        
        const { data: userPerms, error: permError } = await supabase
            .from('permissions')
            .select('can_manage_server')
            .in('role_id', roleIds)
            .eq('can_manage_server', true)
            .limit(1)
            .single();

        if (permError || !userPerms) {
            res.status(403).json({ error: 'You do not have permission to edit roles on this server.' });
            return;
        }

        // --- Step 3: Prepare and validate update data ---
        const updateFields: { name?: string; color?: string } = {};

        if (new_name) {
            updateFields.name = new_name;
        }
        if (new_color) {
            updateFields.color = new_color;
        }

        if (Object.keys(updateFields).length === 0) {
            res.status(400).json({ error: 'No new name or color provided to update.' });
            return;
        }
        
        // --- Step 4: Perform the update ---
        const { data: editedRole, error: editError } = await supabase
            .from('roles')
            .update(updateFields)
            .eq('id', roleId)
            .eq('server_id', serverId)
            .select()
            .single();

        if (editError) {
            // Handle case where roleId doesn't exist on the server.
            if (editError.code === 'PGRST116') {
                res.status(404).json({ error: 'Role not found on this server.' });
                return;
            }
            throw new Error(`Failed to edit role: ${editError.message}`);
        }
        
        res.status(200).json(editedRole);

    } catch (error) {
        const err = error as Error;
        console.error('Error in editRole controller:', err.message);
        res.status(500).json({ error: 'Internal server error.', details: err.message });
    }
};

export const assignRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { server_id } = req.params;
    const { userId: targetUserId, role_name } = req.body;
    const requestingEmailId = req.user?.email;

    // --- Input Validation ---
    if (!requestingEmailId) {
        res.status(401).json({ error: 'Authentication failed. User Email not found in token.' });
        return;
    }
    if (!targetUserId || !role_name) {
        res.status(400).json({ error: 'Target User ID and role name are required in the request body.' });
        return;
    }
    if (!server_id) {
        res.status(400).json({ error: 'Server ID is required in the URL parameters.' });
        return;
    }

    try {
        // --- Step 1: Get the ID of the user making the request ---
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id')
            .ilike('email', requestingEmailId)
            .single();

        if (userError || !userData) {
            res.status(404).json({ error: `User with email ${requestingEmailId} not found.` });
            return;
        }
        const requestingUserId = userData.id;

        // --- Step 2: Call the secure RPC function to handle all logic ---
        const { data: assignedRoleData, error: rpcError } = await supabase.rpc('assign_role_to_user', {
            p_requesting_user_id: requestingUserId,
            p_target_user_id: targetUserId,
            p_server_id: server_id,
            p_role_name: role_name,
        });

        if (rpcError) {
            // The RPC function provides detailed, safe error messages.
            console.error('RPC `assign_role_to_user` error:', rpcError);
            res.status(403).json({ message: 'Failed to assign role.', details: rpcError.message });
            return 
        }

        // --- Success Response ---
        res.status(200).json({
            message: `Successfully assigned role "${role_name}" to the user.`,
            data: assignedRoleData?.[0],
        });

    } catch (error) {
        const err = error as Error;
        console.error('Error in assignRole controller:', err.message);
        res.status(500).json({ error: 'An unexpected internal server error occurred.' });
    }
};

// Delete role
export const deleteRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id, role_id } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is server owner or has manage roles permission
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', server_id)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id !== userId) {
      res.status(403).json({ error: 'Only server owner can delete roles' });
      return;
    }

    // Check if role exists and belongs to this server
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('*')
      .eq('id', role_id)
      .eq('server_id', server_id)
      .single();

    if (roleError || !roleData) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    // Prevent deletion of default roles
    if (roleData.name === 'Member' || roleData.name === 'Admin') {
      res.status(400).json({ error: 'Cannot delete default roles' });
      return;
    }

    // Delete role (this should cascade and remove user_roles entries)
    const { error: deleteError } = await supabase
      .from('roles')
      .delete()
      .eq('id', role_id)
      .eq('server_id', server_id);

    if (deleteError) {
      res.status(500).json({ error: 'Failed to delete role' });
      return;
    }

    res.status(200).json({ message: 'Role deleted successfully' });

  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Remove role from user
export const removeRoleFromUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { server_id } = req.params;
    const { user_id, role_id } = req.body;
    const requesterId = req.user?.sub;

    if (!requesterId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!user_id || !role_id) {
      res.status(400).json({ error: 'User ID and Role ID are required' });
      return;
    }

    // Check if requester is server owner or has manage roles permission
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', server_id)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id !== requesterId) {
      res.status(403).json({ error: 'Only server owner can manage roles' });
      return;
    }

    // Remove role from user
    const { error: removeError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', user_id)
      .eq('role_id', role_id);

    if (removeError) {
      res.status(500).json({ error: 'Failed to remove role from user' });
      return;
    }

    res.status(200).json({ message: 'Role removed from user successfully' });

  } catch (error) {
    console.error('Error removing role from user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all available permissions
export const getAvailablePermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    // Return a list of available permissions
    const permissions = [
      'Manage Server',
      'Manage Roles',
      'Manage Channels',
      'Kick Members',
      'Ban Members',
      'Manage Messages',
      'Send Messages',
      'Manage Invites',
      'View Channels',
      'Connect',
      'Speak',
      'Mute Members',
      'Deafen Members',
      'Move Members'
    ];

    res.status(200).json(permissions);

  } catch (error) {
    console.error('Error getting available permissions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
