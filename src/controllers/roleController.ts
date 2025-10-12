import { Request, Response } from 'express';
import { supabase } from '../client/supabase';
import { getPermissionsByRoleId } from '../middleware/permissionMiddleware';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {v4 as uuidv4} from 'uuid'

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
        // --- DEBUG LOG 2: Check if the user lookup is working ---
        console.log(`Searching for user with username: "${username}"`);
        const { data: targetUserData, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .single();

        if (userError) {
            console.error("Error finding user:", userError);
        }
        console.log("User lookup result:", targetUserData);


        if (userError || !targetUserData) {
            res.status(404).json({ error: `User with username "${username}" not found.` });
            return;
        }
        const targetUserId = targetUserData.id;

        console.log(`Searching for roles for user ID: "${targetUserId}" on server ID: "${server_id}"`);
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
            console.error("Error fetching roles:", rolesError);
        }



        if (rolesError) {
            throw new Error(`Error fetching roles: ${rolesError.message}`);
        }

        if (!userRolesOnServer || userRolesOnServer.length === 0) {
            res.status(404).json({ error: `User "${username}" has no roles on this server.` });
            return;
        }

        console.log("--- Successfully found roles! Sending response. ---");
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
