import * as friendRepository from '../repositories/friendRepository';
import { getCacheRedisClient } from '../redis/cacheClient';


export class AppError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
    }
}

export async function getfriends(userId: string) {
    try {
        const redis = getCacheRedisClient();

        if (redis.status === 'wait') {
            await redis.connect();
        }

        const cacheKey = `friends:${userId}`;
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return JSON.parse(cachedData);
        } else {
            const data = await friendRepository.getFriendList(userId);
            // Use a Map to ensure uniqueness of friends
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
            await redis.set(cacheKey, JSON.stringify(friends), 'EX', 1800);
            return friends;
        }
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new Error(`An unexpected error occurred`);
    }
}

export async function addFriend(user1Id: string, user2Id: string): Promise<void> {
    if (user1Id === user2Id) {
        throw new AppError(400, "You cannot send a friend request to yourself.");
    }

    const existingRequest = await friendRepository.findFriendRequestBetween(user1Id, user2Id);

    if (existingRequest) {
        if (existingRequest.status === 'pending') {
            throw new AppError(409, "A friend request already exists between you and this user.");
        }
        if (existingRequest.status === 'accepted') {
            throw new AppError(409, "You are already friends with this user.");
        }
        if (existingRequest.status === 'rejected') {
            throw new AppError(409, "A previous friend request was rejected. Please wait before sending another.");
        }
    }

    await friendRepository.createFriendRequest(user1Id, user2Id);
}

export async function getFriendRequests(userId: string) {
    return friendRepository.getPendingFriendRequests(userId);
}

export async function respondToFriendRequest(
    requestId: string,
    userId: string,
    status: 'accepted' | 'rejected'
): Promise<void> {
    const request = await friendRepository.findPendingRequestById(requestId);

    if (!request) {
        throw new AppError(404, "Friend request not found or already handled.");
    }

    if (request.user2_id !== userId) {
        throw new AppError(403, "You are not authorized to respond to this friend request.");
    }

    await friendRepository.updateFriendRequestStatus(requestId, status);

    if (status === 'accepted') {
        const u1 = request.user1_id;
        const u2 = request.user2_id;
        const [userA, userB] = u1 < u2 ? [u1, u2] : [u2, u1];

        await friendRepository.createDmThread(userA, userB);
    }
}

export async function searchFriends(userId: string, query: string) {
    const usersData = await friendRepository.searchUsersByUsername(query, userId);

    // Normalize user data with defaults for missing fields
    const normalizedUsers = (usersData || []).map(user => ({
        id: user.id,
        username: user.username || 'Unknown',
        fullname: user.fullname || user.username || 'Unknown User',
        avatar_url: user.avatar_url || null,
        status: user.status || 'offline'
    }));

    const friendsData = await friendRepository.getFriendRelationships(userId);

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
    return normalizedUsers.map(user => ({
        ...user,
        relationshipStatus: relationshipMap.get(user.id) || 'none'
    }));
}

export async function unfriend(userId: string, friendId: string): Promise<void> {
    if (userId === friendId) {
        throw new AppError(400, "You cannot unfriend yourself.");
    }

    const friendship = await friendRepository.findAcceptedFriendship(userId, friendId);

    if (!friendship) {
        throw new AppError(404, "Friendship not found.");
    }

    await friendRepository.deleteFriendship(friendship.friends_id);
}