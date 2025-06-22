/* AUTH MIDDLEWARE HAS NOT BEEN ADDED YET */
import express from "express";
const router = express.Router();

import multer from 'multer';
const storage = multer.memoryStorage();
const upload = multer({ storage }); 

import { messagePostController, messageGetController } from "../controllers/messageController";

/*IMPORTANT : change the REST route below to the socket architecture as needed */

/*IMPORTANT : implement the auth middleware*/

router.post('/upload', upload.single('file'), messagePostController);
router.get('/fetch', messageGetController);

export default router;