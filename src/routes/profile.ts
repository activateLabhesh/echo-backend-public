import express from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { updateProfile, upload, updateStatus } from '../controllers/profileController';

const router = express.Router();

router.put('/update', authenticate, upload.single('avatar'), updateProfile);

router.put('/update-status', authenticate, updateStatus);

export default router;
