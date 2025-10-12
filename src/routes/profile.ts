import {Router} from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { getProfile, updateProfile, updateStatus,deleteProfile,removeAvatar, getUserProfileById } from '../controllers/profileController';
import { busboyMiddleware } from '../middleware/busboyMiddleware';


const router = Router();

router.get('/getProfile', authenticate, getProfile);
router.get('/:userId', authenticate, getUserProfileById);
router.patch('/updateProfile', authenticate, busboyMiddleware, updateProfile);
router.patch('/updatestatus', authenticate, updateStatus);
router.delete('/deleteProfile', authenticate, deleteProfile);
router.delete('/removeAvatar', authenticate, removeAvatar);

export default router;