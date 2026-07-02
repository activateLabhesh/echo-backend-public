import { supabase } from '../client/supabase';

export async function getFriendList(userId: string) {
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
        throw new Error(`Error fetching friends: ${error.message}`);
    }

    return data;
}

// Finds any existing friend row between two users, in either direction (pending/accepted/rejected)
export async function findFriendRequestBetween(user1Id: string, user2Id: string) {
    const { data, error } = await supabase
        .from('friends')
        .select('friends_id, status')
        .or(`and(user1_id.eq.${user1Id},user2_id.eq.${user2Id}),and(user1_id.eq.${user2Id},user2_id.eq.${user1Id})`)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        throw new Error(`Error checking for existing friend request: ${error.message}`);
    }

    return data;
}

export async function createFriendRequest(user1Id: string, user2Id: string) {
    const { error } = await supabase
        .from('friends')
        .insert({
            user1_id: user1Id,
            user2_id: user2Id,
            status: 'pending'
        });

    if (error) {
        throw new Error(`Error creating friend request: ${error.message}`);
    }
}

export async function getPendingFriendRequests(userId: string) {
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
        throw new Error(`Error fetching friend requests: ${error.message}`);
    }

    return data;
}

export async function findPendingRequestById(requestId: string) {
    const { data, error } = await supabase
        .from('friends')
        .select('friends_id, user1_id, user2_id')
        .eq('friends_id', requestId)
        .eq('status', 'pending')
        .single();

    if (error || !data) {
        return null;
    }

    return data;
}

export async function updateFriendRequestStatus(requestId: string, status: 'accepted' | 'rejected') {
    const { error } = await supabase
        .from('friends')
        .update({ status })
        .eq('friends_id', requestId);

    if (error) {
        throw new Error(`Error updating friend request: ${error.message}`);
    }
}

export async function createDmThread(userAId: string, userBId: string) {
    const { error } = await supabase
        .from('dm_threads')
        .insert({
            user1_id: userAId,
            user2_id: userBId
        });

    if (error && error.code !== '23505') {
        throw new Error(`Error creating dm thread: ${error.message}`);
    }
}

export async function searchUsersByUsername(query: string, excludeUserId: string) {
    const { data, error } = await supabase
        .from('users')
        .select('id, username, fullname, avatar_url, status')
        .ilike('username', `%${query}%`)
        .neq('id', excludeUserId)
        .limit(10);

    if (error) {
        throw new Error(`Error searching users: ${error.message}`);
    }

    return data;
}

export async function getFriendRelationships(userId: string) {
    const { data, error } = await supabase
        .from('friends')
        .select('user1_id, user2_id, status')
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (error) {
        throw new Error(`Error fetching friend relationships: ${error.message}`);
    }

    return data;
}

export async function findAcceptedFriendship(userId: string, friendId: string) {
    const { data, error } = await supabase
        .from('friends')
        .select('friends_id')
        .eq('status', 'accepted')
        .or(`and(user1_id.eq.${userId},user2_id.eq.${friendId}),and(user1_id.eq.${friendId},user2_id.eq.${userId})`)
        .maybeSingle();

    if (error && error.code !== 'PGRST116') {
        throw new Error(`Error finding friendship: ${error.message}`);
    }

    return data;
}

export async function deleteFriendship(friendsId: string) {
    const { error } = await supabase
        .from('friends')
        .delete()
        .eq('friends_id', friendsId);

    if (error) {
        throw new Error(`Error deleting friendship: ${error.message}`);
    }
}