import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import * as friendService from '../services/friendService';

function handleError(res: Response, error: unknown): void {
    if (error instanceof friendService.AppError) {
        res.status(error.statusCode).json({ message: error.message });
        return;
    }
    res.status(500).json({ message: "An unexpected error occurred." });
}

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

    try {
        await friendService.addFriend(user1_id, user2_id);
        res.status(201).json({ message: "Friend request sent." });
    } catch (error) {
        handleError(res, error);
    }
};

export const get_friend_requests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    try {
        const data = await friendService.getFriendRequests(userId);
        res.status(200).json(data);
    } catch (error) {
        handleError(res, error);
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
        await friendService.respondToFriendRequest(requestId, userId, status);
        res.status(200).json({ message: `Friend request ${status}.` });
    } catch (error) {
        handleError(res, error);
    }
};

export const fetch_friends = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    try {
        const friends = await friendService.getfriends(userId);
        res.status(200).json(friends);
    } catch (error) {
        handleError(res, error);
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
        const results = await friendService.searchFriends(userId, query);
        res.status(200).json(results);
    } catch (error) {
        handleError(res, error);
    }
};

export const unfriend = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;
    const { friendId } = req.params;

    if (!userId) {
        res.status(401).json({ message: "Unauthorized. Please log in." });
        return;
    }

    if (!friendId) {
        res.status(400).json({ message: "Friend ID is required." });
        return;
    }

    try {
        await friendService.unfriend(userId, friendId);
        res.status(200).json({ message: "Friend removed successfully." });
    } catch (error) {
        handleError(res, error);
    }
};