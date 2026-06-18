import {Router} from "express";
import multer from 'multer';
import { authenticate } from '../middleware/authMiddleware';
import { 
  channelmessagePostController, 
  messageGetController, 
  getDmMessages, 
  dmMessagePostController, 
  getDmThreadMessages, 
  getUnreadCounts, 
  markThreadAsRead, 
  toggleMessageReaction, 
  getMessageReactions, 
  searchChannelMessages, 
  searchDmMessages, 
  getChannelMedia, 
  getDmMedia, 
  getPinnedMessages, 
  pinMessage, 
  unpinMessage 
} from "../controllers/messageController";

const router = Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 12,
  },
}); 


// Message creation
router.post('/upload', authenticate, upload.fields([
  { name: 'image', maxCount: 6 },
  { name: 'file', maxCount: 6 }
]), channelmessagePostController);

router.post('/upload_dm', authenticate, upload.fields([
  { name: 'image', maxCount: 6 },
  { name: 'file', maxCount: 6 }
]), dmMessagePostController);

// Message fetching
router.get('/fetch', authenticate, messageGetController);
router.get('/dm/:threadId', authenticate, getDmThreadMessages);

// Search
router.get('/search/server/:serverId', authenticate, searchChannelMessages);
router.get('/search/dm/:threadId', authenticate, searchDmMessages);

// Media
router.get('/media/server/:serverId', authenticate, getChannelMedia);
router.get('/media/dm/:threadId', authenticate, getDmMedia);

// Reactions
router.get('/reactions', authenticate, getMessageReactions);
router.post('/reactions/toggle', authenticate, toggleMessageReaction);

// Pins
router.get('/pins', authenticate, getPinnedMessages);
router.post('/pins', authenticate, pinMessage);
router.delete('/pins', authenticate, unpinMessage);

// Read status
router.post('/thread/:threadId/mark-read', authenticate, markThreadAsRead);

// User-specific routes (keep dynamic routes near bottom)
router.get('/:userId/getDms', authenticate, getDmMessages);
router.get('/:userId/unread-counts', authenticate, getUnreadCounts);

export default router;
