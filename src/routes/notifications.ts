import { Router } from 'express';
import { registerPushToken, removePushToken } from '../controllers/notificationController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.post('/token', authenticate, registerPushToken);
router.delete('/token', authenticate, removePushToken);

export default router;
