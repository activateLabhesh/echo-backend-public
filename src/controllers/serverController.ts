import { Request,Response } from 'express';
import { supabase } from '../client/supabase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {v4} from 'uuid';
import { error } from 'console';

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
  const file = req.file;

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
          .single();

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


export const joinWithInvite = async(req:Request, res:Response):Promise<any> =>{
  const {invite_id, user_id } = req.body;
  if(!invite_id){
    return res.status(400).json({error:"No invite_id received in body"});
  }
  if(!user_id){
    return res.status(400).json({error:"No user_id received in body"});
  }
  try{
    const {data: invite_data, error: queryerror} = await supabase
        .from('invites')
        .select('*')
        .eq('id', invite_id)
    if(queryerror){
      console.log(`Error in querying from invites table : ${queryerror}`);
      return res.status(500).json({error : "Server Error in querying from invites"});
    }
    if(!invite_data){
      return res.status(404).json({error : "No such invite id found"});
    }

    //now check if the limit is already over or expired invite or is still valid
    
    //then check if the user is already a part of this server

    //if yes then add this user in the server_members table 

    //increment the number of people used this in this invite
  }
  catch(e){

  }
}