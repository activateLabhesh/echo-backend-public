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
        // Check if a friend request already exists in either direction
        const { data: existingRequest, error: existingError } = await supabase
            .from('friends')
            .select('friends_id, status')
            .or(`and(user1_id.eq.${user1_id},user2_id.eq.${user2_id}),and(user1_id.eq.${user2_id},user2_id.eq.${user1_id})`)
            .maybeSingle();

        if (existingError && existingError.code !== 'PGRST116') {
            console.error("Error checking for existing friend request:", existingError);
            res.status(500).json({ message: "Error checking for existing friend request." });
            return;
        }

        if (existingRequest) {
            if (existingRequest.status === 'pending') {
                res.status(409).json({ message: "A friend request already exists between you and this user." });
            } else if (existingRequest.status === 'accepted') {
                res.status(409).json({ message: "You are already friends with this user." });
            } else if (existingRequest.status === 'rejected') {
                res.status(409).json({ message: "A previous friend request was rejected. Please wait before sending another." });
            }
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
            const u1 = request.user1_id
            const u2 = request.user2_id

            const [userA, userB] = u1 < u2 ? [u1, u2] : [u2, u1]

            const { error } = await supabase
                .from('dm_threads')
                .insert({
                    user1_id: userA,
                    user2_id: userB
                })

            // 23505 = unique violation → thread already exists (OK)
            if (error && error.code !== '23505') {
                console.error('Error creating DM thread:', error)
                throw error
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
                friends_id,
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

        // Use a Map to deduplicate friends by their ID
        const friendsMap = new Map();
        
        data.forEach(friendship => {
            const friend = friendship.user1_id === userId ? friendship.user2 : friendship.user1;
            if (friend && (friend as any).id) {
                // Only add if not already in map (prevents duplicates)
                if (!friendsMap.has((friend as any).id)) {
                    friendsMap.set((friend as any).id, friend);
                }
            }
        });

        // Convert map values to array
        const friends = Array.from(friendsMap.values());

        res.status(200).json(friends);

    } catch (error) {
        res.status(500).json({ message: "An unexpected error occurred." });
    }
};

export const search_friends = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;
    const query = req.query.q as string;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        res.status(400).json({ message: "A search query is required." });
        return;
    }

    try {
        // Search users by username (case-insensitive, partial match)
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id, username, fullname, avatar_url, status')
            .ilike('username', `%${query}%`)
            .neq('id', userId) // Don't include current user
            .limit(10);

        if (usersError) {
            console.error("Error searching users:", usersError);
            res.status(500).json({ message: "Failed to search users." });
            return;
        }

        // Normalize user data with defaults for missing fields
        const normalizedUsers = (usersData || []).map(user => ({
            id: user.id,
            username: user.username || 'Unknown',
            fullname: user.fullname || user.username || 'Unknown User',
            avatar_url: user.avatar_url || null,
            status: user.status || 'offline'
        }));

        // Get existing friend relationships and pending requests
        const { data: friendsData, error: friendsError } = await supabase
            .from('friends')
            .select('user1_id, user2_id, status')
            .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

        if (friendsError) {
            console.error("Error fetching friend status:", friendsError);
            res.status(500).json({ message: "Failed to fetch friend status." });
            return;
        }

        // Create a map of user relationships
        const relationshipMap = new Map<string, string>();
        friendsData?.forEach(friend => {
            if (friend.user1_id === userId) {
                relationshipMap.set(friend.user2_id, friend.status);
            } else if (friend.user2_id === userId) {
                relationshipMap.set(friend.user1_id, friend.status);
            }
        });

        // Add relationship status to each user
        const results = normalizedUsers.map(user => ({
            ...user,
            relationshipStatus: relationshipMap.get(user.id) || 'none'
        }));

        res.status(200).json(results);

    } catch (error) {
        console.error("Error in search_friends:", error);
        res.status(500).json({ message: "An unexpected error occurred." });
    }
};
