import {Router} from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { 
    getProfile, 
    updateProfile, 
    updateStatus,
    deleteProfile,
    removeAvatar, 
    getUserProfileById 
} from '../controllers/profileController';
import { busboyMiddleware } from '../middleware/busboyMiddleware';

const router = Router();

// Current user
router.get('/getProfile', authenticate, getProfile);
router.patch('/updateProfile', authenticate, busboyMiddleware, updateProfile);
router.patch('/updatestatus', authenticate, updateStatus);

router.delete('/removeAvatar', authenticate, removeAvatar);
router.delete('/deleteProfile', authenticate, deleteProfile);

// Other users
router.get('/:userId', authenticate, getUserProfileById);

export default router;