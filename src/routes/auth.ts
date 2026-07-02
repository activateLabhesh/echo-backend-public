import express from 'express';

import {
    // register, 
    // login,
    handleGoogleOAuth,
    sendResetPasswordEmail,
    updatePassword,refreshToken, 
    logout,testRoute, 
    changePassword, 
    authorize, 
    handleOAuthUser 
} from '../controllers/authController';

const router = express.Router();

//test-route
router.get('/test', testRoute); 

//google o-auth
router.post('/google-oauth', handleGoogleOAuth);

//routes being used
router.get('/authorize', authorize);
router.post('/oauth-user', handleOAuthUser);
router.post('/refresh', refreshToken);
router.get('/logout',logout);

//older routes
// router.post('/register',register);
// router.post('/login',login);
router.post('/forgot-password', sendResetPasswordEmail);
router.post('/reset-password', updatePassword);
router.post('/change-password', changePassword);

export default router;
