import {Router} from 'express'
import { add_friend, get_friend_requests, respond_to_friend_request, fetch_friends, search_friends, unfriend } from '../controllers/friendsController';
import { authenticate } from '../middleware/authMiddleware';


const router = Router();

router.post('/add_friend', authenticate, add_friend);
router.get('/friend_requests', authenticate, get_friend_requests);
router.put('/request', authenticate, respond_to_friend_request);
router.get('/all', authenticate, fetch_friends);
router.get('/search', authenticate, search_friends);
router.delete('/:friendId', authenticate, unfriend);


export default router;
