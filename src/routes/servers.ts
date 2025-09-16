
import express from 'express';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
import { screation, getServers, joinServer,inviteToServer,  joinWithInvite } from '../controllers/serverController';
import {Router} from 'express';
import { screation, getServers, joinServer } from '../controllers/serverController';
import { authenticate } from '../middleware/authMiddleware';
import { busboyMiddleware } from '../middleware/busboyMiddleware';

const router = Router();

router.post('/create/', authenticate,busboyMiddleware, screation);
router.get('/getServers/', authenticate, getServers);
router.post('/joinServer/',authenticate,joinServer);
router.post('/invite',inviteToServer);
router.post('/joinwithinvite', joinWithInvite);

export default router;
