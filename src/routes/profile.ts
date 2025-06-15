import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { updateProfile, upload, updateStatus } from '../controllers/profileController';

const router = express.Router();

router.put('/update', authenticateToken, upload.single('avatar'), updateProfile);

router.put('/update-status', authenticateToken, updateStatus);

export default router;
