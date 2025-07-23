import express from 'express';

import { updateProfile } from '../controllers/userController';

const router = express.Router();

router.post('/updateProfile', updateProfile); 

export default router;
