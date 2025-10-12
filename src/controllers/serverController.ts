import { Request,Response } from 'express';
import { supabase } from '../client/supabase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {v4} from 'uuid';
import { error } from 'console';
import { RequestWithBusboy } from '../middleware/busboyMiddleware';


/**
 * Handles the creation of a new server.
 * This involves:
 * 1. Uploading an icon to Supabase Storage.
 * 2. Finding the user's ID from their email.
 * 3. Calling a single database RPC to create the server and all its
 * related resources (member, channel, roles) in one transaction.
 * 4. Fetching and returning the complete server object.
 */
export const screation = async (req: AuthenticatedRequest, res: Response): Promise<void>=> {
  const { name } = req.body;
  const user = req.user;
  const email_Id = user?.email;
  const file = (req as RequestWithBusboy).busboyFile;

  // --- Input Validation ---
  if (!file) {
    res.status(400).json({ error: 'Icon image is required' });
    return 
  }
  if (!name) {
    res.status(400).json({ error: 'Server name is required' });
    return   
  }
  if (!email_Id) {
    res.status(401).json({ error: 'Authentication error: User email not found.' });
    return   
  }

  try {
    // --- 1. Upload Icon to Storage ---
    const filePath = `icons/${Date.now()}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from('server-icons')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError);
      res.status(500).json({ error: 'Image upload failed', details: uploadError.message });
    return     
    }

    const { data: urlData } = supabase.storage.from('server-icons').getPublicUrl(filePath);
    const icon_url = urlData?.publicUrl;

    if (!icon_url) {
      res.status(500).json({ error: 'Failed to get public URL for uploaded icon.' });
      return     
    }

    // --- 2. Get User ID ---
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .ilike('email', email_Id)
      .single();

    if (userError || !userData) {
      console.error('User lookup error:', userError);
      res.status(404).json({ error: `User not found.`, details: userError?.message });
          return 
    }
    const user_Id = userData.id;

    // --- 3. Call RPC for Transactional Creation ---
    const { data: newServerId, error: rpcError } = await supabase.rpc('create_server_with_resources', {
    server_name: name,
    server_icon_url: icon_url,
    owner_user_id: user_Id,
    });

    if (rpcError) {
      // The RPC handles the transaction, so if it fails, nothing is committed to the DB.
      console.error('RPC `create_server_with_resources` error:', rpcError);
      res.status(500).json({ message: 'Error creating server', details: rpcError.message });
          return 
    }

    // --- 4. Fetch and Return Full Server Data ---
    const { data: fullServer, error: fetchError } = await supabase
      .from('servers')
      .select(`*, server_members (*), channels (*)`)
      .eq('id', newServerId)
      .single();

    if (fetchError) {
      console.error('Error fetching newly created server:', fetchError);
      // The server was created, but we failed to fetch the full object for the response.
      // A 207 status indicates partial success.
      res.status(207).json({ 
          message: 'Server created successfully, but failed to fetch the complete data.', 
          serverId: newServerId,
          details: fetchError.message 
      });
          return 
    }

    res.status(201).json(fullServer);
    return 

  } catch (err) {
    console.error('Unexpected error in server creation:', err);
    const details = err instanceof Error ? err.message : 'An unknown error occurred.';
    res.status(500).json({ message: 'An unexpected error occurred.', details });
    return 
  }
};

export const getServers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    console.log(req.user);
      const userId = req.user?.sub;

      if (!userId) {
          res.status(401).json({ error: 'Not authenticated or user ID missing' });
          return;
      }

      const { data: memberEntries, error: memberError } = await supabase
          .from('server_members')
          .select('server_id')
          .eq('user_id', userId); 

      if (memberError) {
          throw new Error(`Database error fetching memberships: ${memberError.message}`);
      }

      if (!memberEntries || memberEntries.length === 0) {
          res.status(200).json([]);
          return;
      }

      const serverIds = memberEntries.map(entry => entry.server_id);

      const { data: servers, error: serverError } = await supabase
          .from('servers')
          .select('name, icon_url, id')
          .in('id', serverIds);

      if (serverError) {
          throw new Error(`Database error fetching servers: ${serverError.message}`);
      }

      res.status(200).json(servers || []);

  } catch (error) {
      const err = error as Error;
      console.error('Error in getServers controller:', err.message);
      res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

export const joinServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { serverId } = req.body;
    const email_Id = req.user?.email;

    if (!serverId) {
        res.status(400).json({ error: 'Server ID is required in the request body.' });
        return;
    }
    if (!email_Id) {
        res.status(401).json({ error: 'Authentication error: User email not found.' });
        return;
    }

    try {
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id')
            .ilike('email', email_Id)
            .single();

        if (userError || !userData) {
            res.status(404).json({ error: `User with email ${email_Id} not found.` });
            return;
        }
        const requestingUserId = userData.id;

        const { data: newMember, error: rpcError } = await supabase.rpc('join_server_and_assign_member_role', {
            p_server_id: serverId,
            p_user_id: requestingUserId,
        });

        if (rpcError) {
            console.error('RPC `join_server_and_assign_member_role` error:', rpcError);
            res.status(409).json({ message: 'Failed to join server.', details: rpcError.message });
            return 
          }

        res.status(201).json({
            message: 'Successfully joined the server and assigned Member role.',
            data: newMember?.[0] 
        });

    } catch (error) {
        const err = error as Error;
        console.error('Error in joinServer controller:', err.message);
        res.status(500).json({ error: 'An unexpected internal server error occurred.' });
    }
};

interface Invite {
  id: string;
  inviter_id: string;
  server_id: string;
  use_limit: number | null;   
  expiry: string | null;      
  people_joined: number;
  is_valid: boolean;
}

//change to AuthorizedRequest if needed.
export const inviteToServer = async(req:Request, res:Response):Promise<any> =>{
  const { server_id, user_id , limit , expiry } = req.body;
  if (!server_id) {
        res.status(400).json({ error: 'Server ID is required in the request body.' });
        return;
    }
  if(!user_id){
      res.status(400).json({error: 'User id is required in request body .'});
  }
  //if no expiry , then its always valid .
  //if no limit , any number of users can use to join the server with that link
  try{

    //check for roles
    //first lets query this serverand check if this user is the owner (also if this server really exists)
    const {data: serverData , error:queryerror} = await supabase
          .from('servers')
          .select('owner_id')
          .eq('server_id', server_id)
          .maybeSingle();

    if(!serverData){
      return res.status(404).json({error:"No such server id found"});
    }
    if(queryerror){
      console.log(`Error in querying from servers table while creating invite : ${queryerror}`);
      return res.status(500).json({error:"Server Error"});
    }

    if(serverData.owner_id != user_id){
      return res.status(404).json({error:"User given is not the owner"})
    }

    const id = v4();
    const { error: insertError } = await supabase.from('invites').insert({
          id,
          inviter_id: user_id,
          server_id,
          use_limit: limit,
          expiry,
          people_joined:0,//initially
          is_valid:true
    });
    if(insertError){
      console.log(`Error in creating invite : ${insertError}`);
      return res.status(500).json({error:" Could not create invite"});
    }
    return res.status(201).json({invite_id : id});

  }
  catch(e){
    console.log(`Error in creating invite : ${e}`);
    return res.status(500).json({error:" Could not create invite"});
  }
};



export const joinWithInvite = async(req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { inviteCode } = req.body;
  const email_Id = req.user?.email;
  const userId = req.user?.sub;

  if (!email_Id) {
    res.status(401).json({ error: 'Authentication error: User email not found.' });
    return;
  }

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!inviteCode) {
    res.status(400).json({ error: 'Invite code is required' });
    return;
  }

  // Extract UUID from invite URL or use directly if it's already a UUID
  let inviteId: string;
  if (inviteCode.includes('/invite/')) {
    // Extract UUID from URL like: http://localhost:3000/invite/f7bff380-6d86-4f83-9388-f89143b3adc1
    const urlParts = inviteCode.split('/invite/');
    inviteId = urlParts[1];
  } else {
    // Assume it's already a UUID
    inviteId = inviteCode;
  }

  console.log('Extracted invite ID:', inviteId);

  if (!inviteId) {
    res.status(400).json({ error: 'Invalid invite code format' });
    return;
  }
  try {
    console.log('Looking up invite in database...');
    const { data: invite_data, error: queryerror } = await supabase
        .from('invites')
        .select('*')
        .eq('id', inviteId)
        .single();
    
    const invite = invite_data as Invite | null;
    
    if (!invite) {
      res.status(404).json({ error: "No such invite found" });
      return;
    }
    
    if (queryerror) {
      console.log(`Error in querying from invites table: ${queryerror}`);
      res.status(500).json({ error: "Server Error in querying from invites" });
      return;
    }

    console.log('Found invite:', invite);

    // Check if the limit is already over or expired invite or is still valid
    if (invite && invite.use_limit && invite.use_limit <= invite.people_joined) {
      res.status(400).json({ error: "More people cannot join using this invite" });
      return;
    }
    
    if (invite.expiry && new Date(invite.expiry) < new Date()) {
      res.status(400).json({ error: "This invite has expired" });
      return;
    }

    // Check if the user is already a part of this server
    const { data: existingMember, error: memberError } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", invite.server_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberError) {
      console.log("Error checking membership:", memberError);
      res.status(500).json({ error: "Server error while checking membership" });
      return;
    }

    if (existingMember) {
      res.status(400).json({ error: "User is already a member of this server" });
      return;
    }

    console.log('Adding user to server using RPC...');

    // Use the RPC function to add user to server (same as regular joinServer)
    const { data: newMember, error: rpcError } = await supabase.rpc('join_server_and_assign_member_role', {
      p_server_id: invite.server_id,
      p_user_id: userId,
    });

    if (rpcError) {
      console.error('RPC `join_server_and_assign_member_role` error:', rpcError);
      res.status(500).json({ error: "Could not add user to server", details: rpcError.message });
      return;
    }

    // Update invite usage count
    const { error: updateError } = await supabase
      .from("invites")
      .update({ people_joined: invite.people_joined + 1 })
      .eq("id", inviteId);

    if (updateError) {
      console.log("Error updating invite usage:", updateError);
    }

    console.log('Successfully joined server via invite');

    res.status(201).json({
      message: "Successfully joined the server via invite",
      server_id: invite.server_id,
      data: newMember?.[0]
    });

  } catch (e) {
    console.log(`Error in joining server with invite: ${e}`);
    res.status(500).json({ error: 'Server Error' });
  }
}

// Update server details (name, icon, region)
export const updateServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { name } = req.body;
    const iconFile = (req as any).busboyFile;
    const userId = req.user?.sub;

    console.log('Update server request:', {
      serverId,
      name,
      hasIconFile: !!iconFile,
      userId
    });

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!serverId) {
      res.status(400).json({ error: 'Server ID is required' });
      return;
    }

    // Check if user is server owner or has manage server permission
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id !== userId) {
      res.status(403).json({ error: 'Only server owner can update server settings' });
      return;
    }

    const updateData: any = {};
    if (name) updateData.name = name;

    // Handle icon upload if provided
    if (iconFile) {
      try {
        const fileExtension = iconFile.mimetype.split('/')[1];
        const fileName = `server-${serverId}-icon-${Date.now()}.${fileExtension}`;
        const filePath = `server-icons/${fileName}`;

        console.log('Attempting to upload file:', {
          fileName,
          filePath,
          mimetype: iconFile.mimetype,
          size: iconFile.size
        });

        // First, let's try to create the bucket if it doesn't exist
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets?.some(bucket => bucket.name === 'server-icons');
        
        if (!bucketExists) {
          console.log('Creating server-icons bucket...');
          const { error: bucketError } = await supabase.storage.createBucket('server-icons', {
            public: true,
            allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
          });
          
          if (bucketError) {
            console.error('Failed to create bucket:', bucketError);
            // Continue anyway, bucket might exist but not be listed
          }
        }

        const { error: uploadError } = await supabase.storage
          .from('server-icons')
          .upload(filePath, iconFile.buffer, {
            contentType: iconFile.mimetype,
            upsert: true
          });

        if (uploadError) {
          console.error('Supabase storage upload error:', uploadError);
          res.status(500).json({ error: 'Failed to upload server icon: ' + uploadError.message });
          return;
        }

        const { data: urlData } = supabase.storage.from('server-icons').getPublicUrl(filePath);
        updateData.icon_url = urlData?.publicUrl;
        
        console.log('File uploaded successfully, URL:', updateData.icon_url);
      } catch (fileError) {
        console.error('File upload error:', fileError);
        res.status(500).json({ error: 'File upload failed: ' + (fileError as Error).message });
        return;
      }
    }

    console.log('Updating server with data:', updateData);

    const { data: updatedServer, error: updateError } = await supabase
      .from('servers')
      .update(updateData)
      .eq('id', serverId)
      .select()
      .single();

    if (updateError) {
      console.error('Database update error:', updateError);
      res.status(500).json({ error: 'Failed to update server: ' + updateError.message });
      return;
    }

    console.log('Server updated successfully:', updatedServer);
    res.status(200).json({ message: 'Server updated successfully', server: updatedServer });

  } catch (error) {
    console.error('Error updating server:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get server details
export const getServerDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is member of the server
    const { data: memberData, error: memberError } = await supabase
      .from('server_members')
      .select('*')
      .eq('server_id', serverId)
      .eq('user_id', userId)
      .single();

    if (memberError || !memberData) {
      res.status(403).json({ error: 'Access denied - not a member of this server' });
      return;
    }

    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    res.status(200).json(serverData);

  } catch (error) {
    console.error('Error getting server details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get server members
export const getServerMembers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is the server owner or a member of the server
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const isOwner = serverData.owner_id === userId;

    // If not the owner, check if user is a member
    if (!isOwner) {
      const { data: memberData, error: memberError } = await supabase
        .from('server_members')
        .select('*')
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .single();

      if (memberError || !memberData) {
        res.status(403).json({ error: 'Access denied - not a member of this server' });
        return;
      }
    }

    const { data: members, error: membersError } = await supabase
      .from('server_members')
      .select(`
        user_id,
        joined_at,
        users (
          id,
          username,
          fullname,
          avatar_url
        )
      `)
      .eq('server_id', serverId);

    if (membersError) {
      console.error('Error fetching server members:', membersError);
      res.status(500).json({ error: 'Failed to fetch server members' });
      return;
    }

    // Fetch roles for each member separately
    const membersWithRoles = await Promise.all(
      (members || []).map(async (member) => {
        const { data: userRoles, error: rolesError } = await supabase
          .from('user_roles')
          .select(`
            roles (
              id,
              name,
              color
            )
          `)
          .eq('user_id', member.user_id);

        return {
          ...member,
          user_roles: userRoles || []
        };
      })
    );

    // If owner is not in the members list, add them automatically
    if (isOwner && !membersWithRoles.find(member => member.user_id === userId)) {
      console.log('Server owner not found in members, adding them...');
      
      // Add owner to server_members table
      const { error: addOwnerError } = await supabase
        .from('server_members')
        .insert({
          server_id: serverId,
          user_id: userId,
          joined_at: new Date().toISOString()
        });

      if (addOwnerError) {
        console.error('Error adding owner to server members:', addOwnerError);
      } else {
        // Fetch the owner's user data
        const { data: ownerUser, error: ownerUserError } = await supabase
          .from('users')
          .select('id, username, fullname, avatar_url')
          .eq('id', userId)
          .single();

        if (!ownerUserError && ownerUser) {
          // Fetch owner's roles
          const { data: ownerRoles, error: ownerRolesError } = await supabase
            .from('user_roles')
            .select(`
              roles (
                id,
                name,
                color
              )
            `)
            .eq('user_id', userId);

          // Add owner to the members list
          const ownerMember: any = {
            user_id: userId,
            joined_at: new Date().toISOString(),
            users: ownerUser,
            user_roles: ownerRoles || []
          };
          membersWithRoles.push(ownerMember);
        }
      }
    }

    res.status(200).json(membersWithRoles);

  } catch (error) {
    console.error('Error getting server members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Kick member from server
export const kickMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, userId: targetUserId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user has kick permissions
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // Only owner can kick members for now (can be enhanced with role permissions)
    if (serverData.owner_id !== userId) {
      res.status(403).json({ error: 'Only server owner can kick members' });
      return;
    }

    // Cannot kick yourself
    if (userId === targetUserId) {
      res.status(400).json({ error: 'Cannot kick yourself' });
      return;
    }

    // Remove member from server
    const { error: deleteError } = await supabase
      .from('server_members')
      .delete()
      .eq('server_id', serverId)
      .eq('user_id', targetUserId);

    if (deleteError) {
      res.status(500).json({ error: 'Failed to kick member' });
      return;
    }

    res.status(200).json({ message: 'Member kicked successfully' });

  } catch (error) {
    console.error('Error kicking member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Ban member from server
export const banMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, userId: targetUserId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user has ban permissions
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // Only owner can ban members for now
    if (serverData.owner_id !== userId) {
      res.status(403).json({ error: 'Only server owner can ban members' });
      return;
    }

    // Cannot ban yourself
    if (userId === targetUserId) {
      res.status(400).json({ error: 'Cannot ban yourself' });
      return;
    }

    // Remove member and add to banned list
    const { error: deleteError } = await supabase
      .from('server_members')
      .delete()
      .eq('server_id', serverId)
      .eq('user_id', targetUserId);

    if (deleteError) {
      res.status(500).json({ error: 'Failed to ban member' });
      return;
    }

    // Add to banned users (you might need to create this table)
    // For now, just remove from server
    res.status(200).json({ message: 'Member banned successfully' });

  } catch (error) {
    console.error('Error banning member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Leave server
export const leaveServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is server owner
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id === userId) {
      res.status(400).json({ error: 'Server owner cannot leave. Transfer ownership or delete server instead.' });
      return;
    }

    // Remove user from server
    const { error: deleteError } = await supabase
      .from('server_members')
      .delete()
      .eq('server_id', serverId)
      .eq('user_id', userId);

    if (deleteError) {
      res.status(500).json({ error: 'Failed to leave server' });
      return;
    }

    res.status(200).json({ message: 'Left server successfully' });

  } catch (error) {
    console.error('Error leaving server:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete server (owner only)
export const deleteServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is server owner
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id !== userId) {
      res.status(403).json({ error: 'Only server owner can delete the server' });
      return;
    }

    // Delete server (cascade should handle related records)
    const { error: deleteError } = await supabase
      .from('servers')
      .delete()
      .eq('id', serverId);

    if (deleteError) {
      res.status(500).json({ error: 'Failed to delete server' });
      return;
    }

    res.status(200).json({ message: 'Server deleted successfully' });

  } catch (error) {
    console.error('Error deleting server:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get server invites
export const getServerInvites = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is server owner or has admin role
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError) {
      console.error('Error fetching server data:', serverError);
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (!serverData) {
      console.error('No server data found for serverId:', serverId);
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    console.log('Server data:', serverData);
    console.log('User ID:', userId);
    console.log('Owner ID:', serverData.owner_id);

    const isOwner = serverData.owner_id === userId;
    console.log('Is owner:', isOwner);
    
    let hasAdminRole = false;

    if (!isOwner) {
      console.log('Not owner, checking admin roles...');
      // Check if user has admin role in the server
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select(`
          roles (
            name,
            permissions
          )
        `)
        .eq('user_id', userId);

      console.log('User roles query result:', { userRoles, rolesError });

      if (!rolesError && userRoles) {
        hasAdminRole = userRoles.some((ur: any) => 
          ur.roles && (
            ur.roles.name === 'Admin' || 
            ur.roles.name === 'Owner' ||
            (ur.roles.permissions && ur.roles.permissions.includes('Manage Server'))
          )
        );
        console.log('Has admin role:', hasAdminRole);
      }
    }

    if (!isOwner && !hasAdminRole) {
      console.log('Access denied for user:', userId);
      res.status(403).json({ error: 'Only server admins can view invites' });
      return;
    }

    console.log('Permission granted, fetching invites for server:', serverId);

    // First, let's try a simpler query to test if the table exists and is accessible
    const { data: testQuery, error: testError } = await supabase
      .from('invites')
      .select('id')
      .limit(1);

    console.log('Test query to invites table:', { testQuery, testError });

    if (testError) {
      console.error('Basic invites table test failed:', testError);
      res.status(500).json({ error: 'Database table access issue' });
      return;
    }

    // Now try the full query with the correct columns
    const { data: invites, error: invitesError } = await supabase
      .from('invites')
      .select('id, inviter_id, use_limit, expiry, people_joined, is_valid')
      .eq('server_id', serverId)
      .eq('is_valid', true);

    console.log('Invites query result:', { invites, invitesError });

    if (invitesError) {
      console.error('Error fetching server invites:', invitesError);
      res.status(500).json({ error: 'Failed to fetch server invites' });
      return;
    }

    console.log('Successfully fetched invites:', invites);
    res.status(200).json(invites);

  } catch (error) {
    console.error('Error getting server invites:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete/revoke invite
export const deleteInvite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId, inviteId } = req.params;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user has permission to delete invites
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id !== userId) {
      res.status(403).json({ error: 'Only server owner can delete invites' });
      return;
    }

    // Mark invite as invalid instead of deleting
    const { error: updateError } = await supabase
      .from('invites')
      .update({ is_valid: false })
      .eq('id', inviteId)
      .eq('server_id', serverId);

    if (updateError) {
      res.status(500).json({ error: 'Failed to revoke invite' });
      return;
    }

    res.status(200).json({ message: 'Invite revoked successfully' });

  } catch (error) {
    console.error('Error deleting invite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Enhanced invite creation with expiry and usage limits
export const createServerInvite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { expiresAfter, maxUses } = req.body;
    const userId = req.user?.sub; // Use 'sub' as this is what JWT contains

    console.log('Creating invite for server:', serverId);
    console.log('Request body:', { expiresAfter, maxUses });
    console.log('User ID:', userId);

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user is server owner or has admin role (same logic as getServerInvites)
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError) {
      console.error('Error fetching server data:', serverError);
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (!serverData) {
      console.error('No server data found for serverId:', serverId);
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const isOwner = serverData.owner_id === userId;
    console.log('Is owner:', isOwner);
    
    let hasAdminRole = false;

    if (!isOwner) {
      console.log('Not owner, checking admin roles...');
      // Check if user has admin role in the server
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select(`
          roles (
            name,
            permissions
          )
        `)
        .eq('user_id', userId);

      console.log('User roles query result:', { userRoles, rolesError });

      if (!rolesError && userRoles) {
        hasAdminRole = userRoles.some((ur: any) => 
          ur.roles && (
            ur.roles.name === 'Admin' || 
            ur.roles.name === 'Owner' ||
            (ur.roles.permissions && ur.roles.permissions.includes('Manage Server'))
          )
        );
        console.log('Has admin role:', hasAdminRole);
      }
    }

    if (!isOwner && !hasAdminRole) {
      console.log('Access denied for user:', userId);
      res.status(403).json({ error: 'Only server admins can create invites' });
      return;
    }

    console.log('Permission granted, creating invite...');

    // Calculate expiry date
    let expiryDate = null;
    if (expiresAfter && expiresAfter !== 'Never') {
      const now = new Date();
      switch (expiresAfter) {
        case '30 minutes':
          expiryDate = new Date(now.getTime() + 30 * 60 * 1000);
          break;
        case '1 hour':
          expiryDate = new Date(now.getTime() + 60 * 60 * 1000);
          break;
        case '6 hours':
          expiryDate = new Date(now.getTime() + 6 * 60 * 60 * 1000);
          break;
        case '12 hours':
          expiryDate = new Date(now.getTime() + 12 * 60 * 60 * 1000);
          break;
        case '1 day':
          expiryDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case '7 days':
          expiryDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case '30 days':
          expiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          break;
      }
    }

    // Parse max uses
    let useLimit = null;
    if (maxUses && maxUses !== 'No limit') {
      const numericMatch = maxUses.match(/(\d+)/);
      if (numericMatch) {
        useLimit = parseInt(numericMatch[1]);
      }
    }

    // Generate unique invite ID (UUID format for database)
    const inviteId = v4();
    console.log('Generated invite ID:', inviteId);

    // Create invite record with the correct columns
    const inviteData = {
      id: inviteId,
      inviter_id: userId,
      server_id: serverId,
      use_limit: useLimit,
      expiry: expiryDate?.toISOString(),
      people_joined: 0,
      is_valid: true
    };

    console.log('Invite data to insert:', inviteData);

    const { data: newInvite, error: inviteError } = await supabase
      .from('invites')
      .insert(inviteData)
      .select()
      .single();

    console.log('Insert result:', { newInvite, inviteError });

    if (inviteError) {
      console.error('Error creating invite:', inviteError);
      res.status(500).json({ error: 'Failed to create invite' });
      return;
    }

    console.log('Invite created successfully:', newInvite);

    res.status(201).json({
      message: 'Invite created successfully',
      invite: {
        ...newInvite,
        inviteLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invite/${inviteId}`
      }
    });

  } catch (error) {
    console.error('Error creating server invite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Search users by username (for adding to server)
export const searchUsersByUsername = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { q } = req.query;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    const { data: users, error: searchError } = await supabase
      .from('users')
      .select('id, username, fullname, avatar_url')
      .ilike('username', `%${q}%`)
      .limit(10);

    if (searchError) {
      res.status(500).json({ error: 'Failed to search users' });
      return;
    }

    res.status(200).json(users || []);

  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Add user to server
export const addUserToServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { username } = req.body;
    const requesterId = req.user?.sub;

    if (!requesterId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    // Check if requester has permission to add members
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id !== requesterId) {
      res.status(403).json({ error: 'Only server owner can add members' });
      return;
    }

    // Find user by username
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('username', username.replace('@', ''))
      .single();

    if (userError || !userData) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check if user is already a member
    const { data: existingMember, error: memberCheckError } = await supabase
      .from('server_members')
      .select('*')
      .eq('server_id', serverId)
      .eq('user_id', userData.id)
      .single();

    if (existingMember) {
      res.status(400).json({ error: 'User is already a member of this server' });
      return;
    }

    // Add user to server using the RPC function
    const { data: newMember, error: rpcError } = await supabase.rpc('join_server_and_assign_member_role', {
      p_server_id: serverId,
      p_user_id: userData.id,
    });

    if (rpcError) {
      res.status(500).json({ error: 'Failed to add user to server' });
      return;
    }

    res.status(201).json({
      message: 'User added to server successfully',
      member: newMember
    });

  } catch (error) {
    console.error('Error adding user to server:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Transfer server ownership (owner only)
export const transferOwnership = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { newOwnerId } = req.body;
    const userId = req.user?.sub;

    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!newOwnerId) {
      res.status(400).json({ error: 'New owner ID is required' });
      return;
    }

    // Check if user is current server owner
    const { data: serverData, error: serverError } = await supabase
      .from('servers')
      .select('owner_id, name')
      .eq('id', serverId)
      .single();

    if (serverError || !serverData) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (serverData.owner_id !== userId) {
      res.status(403).json({ error: 'Only server owner can transfer ownership' });
      return;
    }

    if (serverData.owner_id === newOwnerId) {
      res.status(400).json({ error: 'Cannot transfer ownership to yourself' });
      return;
    }

    // Check if new owner is a member of the server
    const { data: memberData, error: memberError } = await supabase
      .from('server_members')
      .select('user_id')
      .eq('server_id', serverId)
      .eq('user_id', newOwnerId)
      .single();

    if (memberError || !memberData) {
      res.status(400).json({ error: 'New owner must be a member of the server' });
      return;
    }

    // Check if new owner exists
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('username')
      .eq('id', newOwnerId)
      .single();

    if (userError || !userData) {
      res.status(400).json({ error: 'New owner user not found' });
      return;
    }

    // Transfer ownership
    const { error: updateError } = await supabase
      .from('servers')
      .update({ owner_id: newOwnerId })
      .eq('id', serverId);

    if (updateError) {
      res.status(500).json({ error: 'Failed to transfer ownership' });
      return;
    }

    res.status(200).json({ 
      message: `Server ownership transferred to ${userData.username}`,
      newOwnerId,
      serverName: serverData.name
    });

  } catch (error) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};