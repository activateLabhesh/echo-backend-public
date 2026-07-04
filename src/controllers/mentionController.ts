import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { mentionService, AppError } from '../services/mentionServices';

function handleError(error: unknown, res: Response, fallbackMessage: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: fallbackMessage });
}

export const getMentions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = (req.user?.sub || req.query.userId) as string | undefined;
    const { limit = 20, unreadOnly = false, channelId } = req.query;

    const mentions = await mentionService.getMentions({
      userId,
      limit,
      unreadOnly,
      channelId: channelId as string | undefined,
    });

    res.json(mentions);
  } catch (error) {
    handleError(error, res, 'Failed to fetch mentions');
  }
};

export const markMentionAsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { mentionId } = req.params;
    const userId = (req.user?.sub || req.query.userId || req.body.userId) as string | undefined;

    const result = await mentionService.markMentionAsRead(mentionId, userId);
    res.json(result);
  } catch (error) {
    handleError(error, res, 'Failed to update mention');
  }
};

export const markAllMentionsAsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = (req.user?.sub || req.query.userId || req.body.userId) as string | undefined;

    const result = await mentionService.markAllMentionsAsRead(userId);
    res.json(result);
  } catch (error) {
    handleError(error, res, 'Failed to update mentions');
  }
};

export const searchMentionable = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { serverId } = req.params;
    const { q } = req.query;
    const query = typeof q === 'string' ? q : '';
    const userId = (req.user?.sub || req.query.userId) as string | undefined;

    const results = await mentionService.searchMentionable(serverId, query, userId);
    res.json(results);
  } catch (error) {
    handleError(error, res, 'Failed to search');
  }
};