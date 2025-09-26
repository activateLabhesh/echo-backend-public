import {Response} from 'express';
import {supabase} from '../client/supabase';
import {AuthenticatedRequest} from '../middleware/authMiddleware';


export const add_friend = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { user2_id } = req.body;
    const user1_id = req.user?.sub;

    if (!user1_id) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    if (!user2_id) {
        res.status(400).json({ message: "Friend ID is required." });
        return;
    }

    if (user1_id === user2_id) {
        res.status(400).json({ message: "You cannot send a friend request to yourself." });
        return;
    }

    try {
        // Check if a friend request already exists
        const { data: existingRequest, error: existingError } = await supabase
            .from('friends')
            .select('friends_id')
            .eq('user1_id', user1_id || user2_id)
            .eq('user2_id',user1_id||user2_id)
            .maybeSingle();

        if (existingError) {
            console.error("Error checking for existing friend request:", existingError);
            res.status(500).json({ message: "Error checking for existing friend request." });
            return;
        }

        if (existingRequest) {
            res.status(409).json({ message: "A friend request already exists between you and this user." });
            return;
        }

        // Send friend request
        const { error: insertError } = await supabase
            .from('friends')
            .insert({
                user1_id: user1_id,
                user2_id: user2_id,
                status: 'pending'
            });

        if (insertError) {
            console.error("Error sending friend request:", insertError);
            res.status(500).json({ message: "Failed to send friend request." });
            return;
        }

        res.status(201).json({ message: "Friend request sent." });

    
}
catch (error) {
        res.status(500).json({ message: "An unexpected error occurred." });
    }
};

export const get_friend_requests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    try {
        const { data, error } = await supabase
            .from('friends')
            .select(`
                friends_id,
                created_at,
                user1_id,
                user1:users!user1_id (
                    username,
                    fullname,
                    avatar_url
                )
            `)
            .eq('user2_id', userId)
            .eq('status', 'pending');

        if (error) {
            console.error("Error fetching friend requests:", error);
            res.status(500).json({ message: "Failed to fetch friend requests." });
            return;
        }

        res.status(200).json(data);

    } catch (error) {
        res.status(500).json({ message: "An unexpected error occurred." });
    }
};

export const respond_to_friend_request = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { requestId, status } = req.body; // status should be 'accepted' or 'rejected'
    const userId = req.user?.sub;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    if (!requestId || !status) {
        res.status(400).json({ message: "Request ID and status are required." });
        return;
    }

    if (status !== 'accepted' && status !== 'rejected') {
        res.status(400).json({ message: "Invalid status. Must be 'accepted' or 'rejected'." });
        return;
    }

    try {
        // Verify the request exists and the current user is the recipient
        const { data: request, error: requestError } = await supabase
            .from('friends')
            .select('friends_id, user1_id, user2_id')
            .eq('friends_id', requestId)
            .eq('status', 'pending')
            .single();

        if (requestError || !request) {
            res.status(404).json({ message: "Friend request not found or already handled." });
            return;
        }

        if (request.user2_id !== userId) {
            res.status(403).json({ message: "You are not authorized to respond to this friend request." });
            return;
        }

        // Update the request status
        const { error: updateError } = await supabase
            .from('friends')
            .update({ status: status })
            .eq('friends_id', requestId);

        if (updateError) {
            console.error("Error updating friend request:", updateError);
            res.status(500).json({ message: "Failed to update friend request." });
            return;
        }

        if (status === 'accepted') {
            // Check if a DM thread already exists
            const { data: thread } = await supabase
                .from('dm_threads')
                .select('id')
                .or(`(user1_id.eq.${request.user1_id},user2_id.eq.${request.user2_id}),(user1_id.eq.${request.user2_id},user2_id.eq.${request.user1_id})`)
                .maybeSingle();

            if (!thread) {
                // Create a new DM thread
                const { error: threadCreationError } = await supabase
                    .from('dm_threads')
                    .insert({
                        user1_id: request.user1_id,
                        user2_id: request.user2_id,
                    });

                if (threadCreationError) {
                    console.error("Error creating DM thread:", threadCreationError);
                    // Not returning an error to the client as the friend request was still successful
                }
            }
        }

        res.status(200).json({ message: `Friend request ${status}.` });

    } catch (error) {
        res.status(500).json({ message: "An unexpected error occurred." });
    }
};

export const fetch_friends = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    try {
        const { data, error } = await supabase
            .from('friends')
            .select(`
                user1_id,
                user2_id,
                user1:users!user1_id (
                    id,
                    username,
                    fullname,
                    avatar_url,
                    status
                ),
                user2:users!user2_id (
                    id,
                    username,
                    fullname,
                    avatar_url,
                    status
                )
            `)
            .eq('status', 'accepted')
            .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

        if (error) {
            console.error("Error fetching friends:", error);
            res.status(500).json({ message: "Failed to fetch friends." });
            return;
        }

        const friends = data.map(friendship => {
            if (friendship.user1_id === userId) {
                return friendship.user2;
            } else {
                return friendship.user1;
            }
        });

        res.status(200).json(friends);

    } catch (error) {
        res.status(500).json({ message: "An unexpected error occurred." });
    }
};

export const search_friends = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;
    const { query } = req.body;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });1
        return;
    }

    if (!query || typeof query !== 'string') {
        res.status(400).json({ message: "A search query is required." });
        return;
    }

    try {
        // First, get all friend IDs
        const { data: friendsData, error: friendsError } = await supabase
            .from('friends')
            .select('user1_id, user2_id')
            .eq('status', 'accepted')
            .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

        if (friendsError) {
            console.error("Error fetching friend relationships:", friendsError);
            res.status(500).json({ message: "Failed to retrieve friend list." });
            return;
        }

        const friendIds = friendsData.map(f => f.user1_id === userId ? f.user2_id : f.user1_id);

        if (friendIds.length === 0) {
            res.status(404).json({ message: "No friend found." });
            return;
        }

        // Then, search within those friends
        const { data, error } = await supabase
            .from('users')
            .select('id, username, fullname, avatar_url, status')
            .in('id', friendIds)
            .or(`username.ilike.%${query}%,fullname.ilike.%${query}%`);

        if (error) {
            console.error("Error searching friends:", error);
            res.status(500).json({ message: "Failed to search friends." });
            return;
        }

        if (!data || data.length === 0) {
            res.status(200).json({ message: "No friend found." });
            return;
        }

        res.status(200).json(data);

    } catch (error) {
        res.status(500).json({ message: "An unexpected error occurred." });
    }
};
