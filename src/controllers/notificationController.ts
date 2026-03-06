import { Response } from 'express';
import { supabase } from '../client/supabase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

/**
 * Register or update a push token for the authenticated user.
 * Uses upsert on push_token to avoid duplicates.
 */
export const registerPushToken = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;

    if (!userId) {
        res.status(401).json({ error: 'Unauthorized: No user context.' });
        return;
    }

    const { push_token, device_type } = req.body;

    if (!push_token || typeof push_token !== 'string') {
        res.status(400).json({ error: 'push_token is required and must be a string.' });
        return;
    }

    const { error } = await supabase
        .from('user_push_tokens')
        .upsert(
            {
                user_id: userId,
                push_token,
                device_type: device_type ?? 'android',
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'push_token' }
        );

    if (error) {
        console.error('[NotificationController] Error upserting push token:', error);
        res.status(500).json({ error: 'Failed to register push token.', detail: error.message });
        return;
    }

    res.status(200).json({ message: 'Push token registered successfully.' });
};

/**
 * Remove a push token (e.g. on logout).
 */
export const removePushToken = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.sub;

    if (!userId) {
        res.status(401).json({ error: 'Unauthorized: No user context.' });
        return;
    }

    const { push_token } = req.body;

    if (!push_token || typeof push_token !== 'string') {
        res.status(400).json({ error: 'push_token is required and must be a string.' });
        return;
    }

    const { error } = await supabase
        .from('user_push_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('push_token', push_token);

    if (error) {
        console.error('[NotificationController] Error removing push token:', error);
        res.status(500).json({ error: 'Failed to remove push token.' });
        return;
    }

    res.status(200).json({ message: 'Push token removed successfully.' });
};
