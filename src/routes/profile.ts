import {Router} from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { getProfile, updateProfile, updateStatus } from '../controllers/profileController';
import { busboyMiddleware } from '../middleware/busboyMiddleware';


const router = Router();

router.get('/getProfile', authenticate, getProfile);
router.patch('/updateProfile', authenticate, busboyMiddleware, updateProfile);
router.patch('/updatestatus', authenticate, updateStatus);

export default router;