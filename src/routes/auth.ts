import express from 'express';
import {register,login, sendResetPasswordEmail,updatePassword,refreshToken, logout,testRoute } from '../controllers/authController';

const router = express.Router();

router.get('/test', testRoute); 
router.get('/refresh', refreshToken);
router.post('/register',register);
router.post('/login',login);
router.get('/logout',logout);
router.post('/forgot-password', sendResetPasswordEmail);
router.post('/reset-password', updatePassword);

export default router;
