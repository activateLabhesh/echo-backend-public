import { Response } from 'express';
import { supabase } from '../client/supabase';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

type DeviceType = 'ios' | 'android' | null;

function normalizePushToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDeviceType(value: unknown): DeviceType {
  if (value === 'ios' || value === 'android') return value;
  return null;
}

function isExpoPushToken(pushToken: string): boolean {
  return /^ExponentPushToken\[[^\]]+\]$/.test(pushToken) || /^ExpoPushToken\[[^\]]+\]$/.test(pushToken);
}

export const registerPushToken = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user?.sub;
  const pushToken = normalizePushToken(req.body?.push_token);
  const deviceType = normalizeDeviceType(req.body?.device_type);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!pushToken) {
    res.status(400).json({ error: 'push_token is required' });
    return;
  }

  if (!isExpoPushToken(pushToken)) {
    res.status(400).json({ error: 'Invalid Expo push token format' });
    return;
  }

  try {
    // Keep a token attached to one user only.
    await supabase
      .from('user_push_tokens')
      .delete()
      .eq('push_token', pushToken)
      .neq('user_id', userId);

    const { data: existing, error: existingError } = await supabase
      .from('user_push_tokens')
      .select('user_id, push_token')
      .eq('user_id', userId)
      .eq('push_token', pushToken)
      .maybeSingle();

    if (existingError) {

      res.status(500).json({ error: 'Failed to register push token' });
      return;
    }

    if (existing) {
      res.status(200).json({ message: 'Push token already registered' });
      return;
    }

    // Attempt insert with device_type when available; retry without it for legacy schemas.
    const payloadWithDevice = deviceType
      ? { user_id: userId, push_token: pushToken, device_type: deviceType }
      : { user_id: userId, push_token: pushToken };

    let { error: insertError } = await supabase.from('user_push_tokens').insert(payloadWithDevice);

    if (insertError && deviceType) {
      const fallback = await supabase
        .from('user_push_tokens')
        .insert({ user_id: userId, push_token: pushToken });
      insertError = fallback.error;
    }

    if (insertError) {

      res.status(500).json({ error: 'Failed to register push token' });
      return;
    }

    res.status(201).json({ message: 'Push token registered' });
  } catch (error: any) {

    res.status(500).json({ error: 'Failed to register push token' });
  }
};

export const removePushToken = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user?.sub;
  const pushToken = normalizePushToken(req.body?.push_token ?? req.query?.push_token);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    let deleteQuery = supabase
      .from('user_push_tokens')
      .delete()
      .eq('user_id', userId);

    if (pushToken) {
      deleteQuery = deleteQuery.eq('push_token', pushToken);
    }

    const { data, error } = await deleteQuery.select('push_token');

    if (error) {

      res.status(500).json({ error: 'Failed to remove push token' });
      return;
    }

    res.status(200).json({
      message: pushToken ? 'Push token removed' : 'Push tokens removed',
      removed: data?.length || 0,
    });
  } catch (error: any) {

    res.status(500).json({ error: 'Failed to remove push token' });
  }
};
