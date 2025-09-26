import {Router} from 'express'
import { add_friend, get_friend_requests, respond_to_friend_request, fetch_friends, search_friends } from '../controllers/friendsController';
import { authenticate } from '../middleware/authMiddleware';


const router = Router();

router.post('/add_friend', authenticate, add_friend);
router.get('/friend_requests', authenticate, get_friend_requests);
router.put('/request', authenticate, respond_to_friend_request);
router.get('/all', authenticate, fetch_friends);
router.get('/search', authenticate, search_friends);


export default router;