import express from "express";
const router = express.Router();

import multer from 'multer';
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 12,
  },
}); 

import { authenticate } from '../middleware/authMiddleware';
import { channelmessagePostController, messageGetController, getDmMessages, dmMessagePostController, getDmThreadMessages, getUnreadCounts, markThreadAsRead, toggleMessageReaction, getMessageReactions, searchChannelMessages, searchDmMessages, getChannelMedia, getDmMedia, getPinnedMessages, pinMessage, unpinMessage } from "../controllers/messageController";

router.post('/upload', authenticate, upload.fields([{name: 'image', maxCount: 6}, {name: 'file', maxCount: 6}]), channelmessagePostController);
router.post('/upload_dm', authenticate, upload.fields([{ name: 'image', maxCount: 6 }, { name: 'file', maxCount: 6 }]), dmMessagePostController);
router.get('/fetch', authenticate, messageGetController);
router.get('/reactions', authenticate, getMessageReactions);
router.post('/reactions/toggle', authenticate, toggleMessageReaction);
router.get('/search/server/:serverId', authenticate, searchChannelMessages);
router.get('/search/dm/:threadId', authenticate, searchDmMessages);
router.get('/media/server/:serverId', authenticate, getChannelMedia);
router.get('/media/dm/:threadId', authenticate, getDmMedia);
router.get('/pins', authenticate, getPinnedMessages);
router.post('/pins', authenticate, pinMessage);
router.delete('/pins', authenticate, unpinMessage);
router.get('/dm/:threadId', authenticate, getDmThreadMessages);
router.get('/:userId/getDms', authenticate, getDmMessages);
router.get('/:userId/unread-counts', authenticate, getUnreadCounts);
router.post('/thread/:threadId/mark-read', authenticate, markThreadAsRead);

export default router;
