/**
 * Push Notification Service
 *
 * Sends Expo push notifications via the Expo Push API.
 * Uses Node's built-in https module to avoid ESM compatibility issues with ts-node.
 */

import https from 'https';
import { supabase } from '../client/supabase';
import { getUserSocket } from '../redis/userSocketStore';
import { userSocketMap } from '../sockets/chatSocket';

// ─── Helpers ───────────────────────────────────────────────────

function isExpoPushToken(token: string): boolean {
    return (
        typeof token === 'string' &&
        (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))
    );
}

async function getTokensForUser(userId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('user_push_tokens')
        .select('push_token')
        .eq('user_id', userId);

    if (error) {
        console.error('[PushNotification] Failed to fetch tokens:', error.message);
        return [];
    }

    return (data || []).map((row: any) => row.push_token).filter(Boolean);
}

async function getUsername(userId: string): Promise<string> {
    const { data, error } = await supabase
        .from('users')
        .select('username')
        .eq('id', userId)
        .single();

    if (error || !data) return 'Someone';
    return data.username || 'Someone';
}

/**
 * Post push notification messages to the Expo Push API.
 * Always resolves (never rejects) — designed for fire-and-forget usage.
 */
function sendExpoPush(messages: any[]): Promise<void> {
    if (messages.length === 0) return Promise.resolve();

    const validMessages = messages.filter((msg) => {
        if (!isExpoPushToken(msg.to)) {
            console.warn('[PushNotification] Skipping invalid token:', msg.to);
            return false;
        }
        return true;
    });

    if (validMessages.length === 0) return Promise.resolve();

    const body = JSON.stringify(validMessages);

    return new Promise((resolve) => {
        const req = https.request(
            {
                hostname: 'exp.host',
                path: '/--/api/v2/push/send',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            },
            (res) => {
                let responseBody = '';
                res.on('data', (chunk) => { responseBody += chunk; });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        console.log(`[PushNotification] Sent ${validMessages.length} notification(s)`);
                    } else {
                        console.error(`[PushNotification] Expo API error (${res.statusCode}):`, responseBody);
                    }
                    resolve();
                });
            },
        );

        req.on('error', (err) => {
            console.error('[PushNotification] Request error:', err.message);
            resolve();
        });

        req.write(body);
        req.end();
    });
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Send a push notification for a new direct message.
 * Called from both the socket handler and the REST upload controller.
 */
export async function sendDmPushNotification(
    senderId: string,
    receiverId: string,
    messagePreview: string,
): Promise<void> {
    try {
        const tokens = await getTokensForUser(receiverId);
        if (tokens.length === 0) return;

        const senderName = await getUsername(senderId);
        const body = messagePreview?.trim()
            ? messagePreview.substring(0, 200)
            : '📎 Sent an attachment';

        const messages = tokens.map((token) => ({
            to: token,
            title: senderName,
            body,
            sound: 'default' as const,
            data: { type: 'dm', senderId, receiverId },
        }));

        await sendExpoPush(messages);
    } catch (err: any) {
        console.error('[PushNotification] sendDmPushNotification error:', err?.message || err);
    }
}

/**
 * Send push notifications for a new channel message to offline members.
 * Called from both the socket handler and the REST upload controller.
 */
export async function sendChannelPushNotification(
    senderId: string,
    channelId: string,
    messagePreview: string,
): Promise<void> {
    try {
        // 1. Look up the channel to get its name and server
        const { data: channel, error: channelError } = await supabase
            .from('channels')
            .select('name, server_id')
            .eq('id', channelId)
            .single();

        if (channelError || !channel) {
            console.error('[PushNotification] Channel not found:', channelId);
            return;
        }

        // 2. Get all server members except the sender
        const { data: members, error: membersError } = await supabase
            .from('server_members')
            .select('user_id')
            .eq('server_id', channel.server_id)
            .neq('user_id', senderId);

        if (membersError || !members || members.length === 0) return;

        // 3. Filter to only offline users (not connected via socket locally or via Redis)
        const offlineUserIds: string[] = [];
        for (const member of members) {
            if (userSocketMap.has(member.user_id)) continue;
            const redisSocket = await getUserSocket(member.user_id);
            if (redisSocket) continue;
            offlineUserIds.push(member.user_id);
        }

        if (offlineUserIds.length === 0) return;

        // 4. Fetch push tokens for offline users
        const { data: tokenRows, error: tokenError } = await supabase
            .from('user_push_tokens')
            .select('push_token')
            .in('user_id', offlineUserIds);

        if (tokenError || !tokenRows || tokenRows.length === 0) return;

        // 5. Build and send notifications
        const senderName = await getUsername(senderId);
        const channelName = channel.name || 'a channel';
        const body = messagePreview?.trim()
            ? messagePreview.substring(0, 200)
            : '📎 Sent an attachment';

        const messages = tokenRows.map((row: any) => ({
            to: row.push_token,
            title: `#${channelName}`,
            body: `${senderName}: ${body}`,
            sound: 'default' as const,
            data: { type: 'channel_message', channelId, serverId: channel.server_id },
        }));

        await sendExpoPush(messages);
    } catch (err: any) {
        console.error('[PushNotification] sendChannelPushNotification error:', err?.message || err);
    }
}
