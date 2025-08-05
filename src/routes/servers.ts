import {Router} from 'express';
import { screation, getServers, joinServer } from '../controllers/serverController';
import { authenticate } from '../middleware/authMiddleware';
import { busboyMiddleware } from '../middleware/busboyMiddleware';

const router = Router();

router.post('/create/', authenticate,busboyMiddleware, screation);
router.get('/getServers/', authenticate, getServers);
router.post('/joinServer/',authenticate,joinServer);

export default router;
