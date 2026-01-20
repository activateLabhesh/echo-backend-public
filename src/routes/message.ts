import express from "express";
const router = express.Router();

import multer from 'multer';
const storage = multer.memoryStorage();
const upload = multer({ storage }); 

import { authenticate } from '../middleware/authMiddleware';
import { channelmessagePostController, messageGetController, getDmMessages, dmMessagePostController, getDmThreadMessages, getUnreadCounts, markThreadAsRead} from "../controllers/messageController";

router.post('/upload', authenticate, upload.fields([{name: 'image', maxCount: 6}, {name: 'file', maxCount: 6}]), channelmessagePostController);
router.post('/upload_dm', authenticate, upload.fields([{ name: 'image', maxCount: 6 }, { name: 'file', maxCount: 6 }]), dmMessagePostController);
router.get('/fetch', authenticate, messageGetController);
router.get('/dm/:threadId', authenticate, getDmThreadMessages);
router.get('/:userId/getDms', authenticate, getDmMessages);
router.get('/:userId/unread-counts', authenticate, getUnreadCounts);
router.post('/thread/:threadId/mark-read', authenticate, markThreadAsRead);

export default router;