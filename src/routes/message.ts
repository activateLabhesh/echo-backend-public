/* AUTH MIDDLEWARE HAS NOT BEEN ADDED YET */
import express from "express";
const router = express.Router();

import multer from 'multer';
const storage = multer.memoryStorage();
const upload = multer({ storage }); 

import { channelmessagePostController, messageGetController, getDmMessages, dmMessagePostController} from "../controllers/messageController";

/*IMPORTANT : change the REST route below to the socket architecture as needed */

/*IMPORTANT : implement the auth middleware*/

router.post('/upload', upload.fields([{name: 'image', maxCount: 6}, {name: 'file', maxCount: 6}]), channelmessagePostController);
// Accept either 'image' or 'file' field for DM uploads to avoid MulterError: Unexpected field
router.post('/upload_dm', upload.fields([{ name: 'image', maxCount: 6 }, { name: 'file', maxCount: 6 }]), dmMessagePostController);
router.get('/fetch', messageGetController);
router.get('/:userId/getDms',getDmMessages);

export default router;