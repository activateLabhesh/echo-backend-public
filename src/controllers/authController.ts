import { Request, Response } from 'express';
import {supabase,supabaseAdmin} from '../client/supabase'
import jwt from 'jsonwebtoken';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, 
};

//test route
export const testRoute = (_req: Request, res: Response) => {
  console.log("Test route hit");
  res.status(200).json({ message: 'Test route is working!' });
};

//register route
export const register = async (req: Request, res: Response): Promise <void> => {
  const { email, password ,username } = req.body;
  console.log('Registering user:', { email, password ,username});

  const { data: existingEmail } = await supabaseAdmin
  .from('users')
  .select('id')
  .eq('email', email)
  .maybeSingle();

  if (existingEmail) {
  res.status(409).json({ message: 'User already registered' });
  return
  }

  const { data: existingUsername } = await supabaseAdmin
  .from('users')
  .select('id')
  .eq('username', username)
  .maybeSingle();

  if (existingUsername) {
  res.status(409).json({ message: 'Username already taken' });
  return
  }

  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error || !signUpData?.user?.id) {
    res.status(400).json({ message: error?.message });
    return
  }
  const userId = signUpData.user.id;

  const { error: insertError } = await supabaseAdmin
  .from('users')
  .insert([
    {
      id: userId,
      email,
      username,
      avatar_url: null,
      status: 'offline',
    },
  ]);

  if (insertError) {
    console.error('Insert error:', insertError.message);
    res.status(500).json({ message: 'Insert Error. Check console ' });
    return
  }

  res.status(201).json({ message: 'User registered.' });
};

// login route
export const login = async (req: Request, res: Response):Promise <void> => {
  const { identifier, password } = req.body;

  let email =identifier;
  //check if identifier is not email, then it is username. search database for that username and extract email from it
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('username', identifier)
      .single();

    if (error || !data) {
      res.status(400).json({ message: 'Invalid username or user not found' });
      return;
    }

    email = data.email;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    res.status(401).json({ message: error?.message || 'Login failed' });
    return
  }

  const { access_token, refresh_token, user } = data.session;

  res.cookie('access_token', access_token, cookieOptions);
  res.cookie('refresh_token', refresh_token, {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });

  res.status(200).json({ message: 'Logged in', user });
};

//refresh tokens
export const refreshToken = async (req: Request, res: Response): Promise <void> => {
  const refresh_token = req.cookies.refresh_token;

  if (!refresh_token) {
    res.status(401).json({ message: 'Refresh token missing' });
    return
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    res.status(401).json({ message: 'Invalid refresh token' });
    return
  }

  const { access_token, refresh_token: newRefreshToken } = data.session;

  res.cookie('access_token', access_token, cookieOptions);
  res.cookie('refresh_token', newRefreshToken, {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });

  res.status(200).json({ message: 'Token refreshed' });
};

//logout route
export const logout = async (req: Request, res: Response): Promise<void> => {
  const accessToken = req.cookies.access_token;

  if (!accessToken) {
    res.status(400).json({ message: 'Already logged out or no token found' });
    return;
  }

  try {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Logout failed', error: (err as Error).message });
  }
};

//send reset password link
export const sendResetPasswordEmail = async (req: Request, res: Response):Promise<void> => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ message: 'Email is required to reset password' });
    return
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.FRONTEND_URL}/reset-password`, 
  });

  if (error) {
    res.status(400).json({ message: error.message });
    return
  }

  res.status(200).json({ message: 'Password reset email sent' });
  return
};

//update password 
export const updatePassword = async (req: Request, res: Response):Promise<void> => {
  const authHeader = req.headers['authorization'];
  const access_token = authHeader?.split(' ')[1];
  const { new_password } = req.body;

  if (!access_token || !new_password) {
    res.status(400).json({ message: 'Access token and new password are required' });
    return
  }

  //extract user id from the token
  let userId: string;
  try {
    const decoded: any = jwt.decode(access_token);
    userId = decoded.sub;
  } catch (err) {
    res.status(400).json({ message: 'Invalid access token' });
    return;
  }

  //update passwrd using admin 
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: new_password,
  });

  // console.log('Admin API response:', { data, error });
  
  if (error) {
    res.status(400).json({ message: error.message });
    return
  }

  res.status(200).json({ message: 'Password updated successfully' });
  return
};