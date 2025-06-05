import express from 'express';
import {register,login, refreshToken, logout,testRoute } from '../controllers/authController';

const router = express.Router();

router.get('/test', testRoute); 
router.get('/refresh', refreshToken);
router.post('/register',register);
router.post('/login',login);
router.get('/logout',logout);

export default router;
