
import { Router } from 'express';
import * as serverController from '../controllers/serverController';
import { authenticate } from '../middleware/authMiddleware';
import { busboyMiddleware } from '../middleware/busboyMiddleware';

const router = Router();

const {
	screation,
	getServers,
	joinServer,
	inviteToServer,
	joinWithInvite,
} = serverController;

router.post('/create/', authenticate,busboyMiddleware, screation);
router.get('/getServers/', authenticate, getServers);
router.post('/joinServer/',authenticate,joinServer);
router.post('/invite',inviteToServer);
router.post('/joinwithinvite', joinWithInvite);

export default router;
