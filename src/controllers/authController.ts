import { Request, Response } from 'express';
import {supabase,supabaseAdmin} from '../client/supabase'
import jwt from 'jsonwebtoken';

// Helper function to get the correct frontend URL based on request origin
const getFrontendUrl = (req: Request): string => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.FRONTEND_URL?.split(',').map(url => url.trim()) || [];
  
  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }
  // Default to first allowed origin or fallback
  return allowedOrigins[0] || 'https://echo.ieeecsvit.com';
};

// Access token expires in 1 hour (matches Supabase JWT expiration)
const ACCESS_TOKEN_MAX_AGE = 60 * 60; // 1 hour in seconds
// Refresh token expires in 30 days
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days in seconds

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
  maxAge: ACCESS_TOKEN_MAX_AGE,
};


//test route
export const testRoute = (_req: Request, res: Response) => {
  console.log("Test route hit");
  res.status(200).json({ message: 'Test route is working!' });
};

//register route
export const register = async (req: Request, res: Response): Promise <void> => {
  const { email, password ,username, fullname, date_of_birth} = req.body;
  console.log('Registering user:', { email, password ,username,fullname,date_of_birth});

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
    options: {
      emailRedirectTo: `${getFrontendUrl(req)}/auth/callback?next=/login`,
    },
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
      fullname,
      date_of_birth,
      avatar_url: null,
      status: 'offline',
      bio:'', //present in supabase
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
  const isMobileApp = req.headers['x-client-type'] === 'Mobile'; //checks where the request is from

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

  const { data: userDetails, error: fetchError } = await supabaseAdmin
  .from('users')
  .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status,created_at')
  .eq('id', user.id)
  .maybeSingle();

if (fetchError || !userDetails) {
  res.status(500).json({ message: 'Failed to fetch user profile details' });
  return;
}

  if(isMobileApp){
    res.status(200).json({
      message : "Logged In",
      user: userDetails,
      accessToken:access_token,
      refreshToken:refresh_token,
      expiresIn: data.session.expires_in,
    })
  } else{
    res.cookie('access_token', access_token, cookieOptions);
    res.cookie('refresh_token', refresh_token, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
    console.log("Logged in the user.");
    res.status(200).json({ 
      message: 'Logged in', 
      user: userDetails,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: data.session.expires_in
    });
  }
};

//refresh tokens
export const refreshToken = async (req: Request, res: Response): Promise <void> => {
  const isMobileApp = req.headers['x-client-type'] === 'Mobile';

  let refresh_token: string | undefined;

  if (isMobileApp) {
    refresh_token = req.body.refresh_token;
  } else {
    refresh_token = req.cookies.refresh_token;
  }

  if (!refresh_token) {
    res.status(401).json({ message: 'Refresh token missing' });
    return
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    res.status(401).json({ message: 'Invalid refresh token' });
    return
  }

  const { access_token, refresh_token: newRefreshToken, user } = data.session;
  console.log("refresh", data.session.expires_in);
  if (isMobileApp) {
    res.status(200).json({
      message: 'Token refreshed',
      accessToken: access_token,
      refreshToken: newRefreshToken,
      user: user,
      expiresIn: data.session.expires_in ///////////////////////////////////////////////////////
    });
  } else {
    res.cookie('access_token', access_token, cookieOptions);
    res.cookie('refresh_token', newRefreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
    res.status(200).json({ 
      message: 'Token refreshed',
      accessToken: access_token,
      refreshToken: newRefreshToken,
      expiresIn: data.session.expires_in
    });
  }
};

//logout route
export const logout = async (req: Request, res: Response): Promise<void> => {

  const isMobileApp = req.headers['X-Client-Type'] === 'mobile-app';
  if(isMobileApp){
    res.status(200).json({ message: 'Logged out successfully' });
  }
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
    redirectTo: `${getFrontendUrl(req)}/reset-password`, 
  });

  if (error) {
    res.status(400).json({ message: error.message });
    return
  }

  res.status(200).json({ message: 'Password reset email sent' });
  return
};

//update password using reset session
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
    const { data: userData, error } = await supabase.auth.getUser(access_token);
    if (error || !userData?.user) {
      res.status(400).json({ message: 'Invalid access token' });
      return;
    }
    userId = userData.user.id;
  } catch (err) {
    res.status(400).json({ message: 'Invalid access token' });
    return;
  }

  //update password using admin 
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: new_password,
  });

  if (error) {
    res.status(400).json({ message: error.message });
    return
  }

  res.status(200).json({ message: 'Password updated successfully' });
  return
};

// change password for logged-in users
export const changePassword = async (req: Request, res: Response): Promise<void> => {

  const authHeader = req.headers['authorization'];
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const cookieToken = req.cookies?.access_token;
  const access_token = headerToken || cookieToken;

  const { new_password } = req.body;

  if (!access_token || !new_password) {
    res.status(400).json({ message: 'Access token and new password are required' });
    return;
  }

  // decode token to get user id (sub)
  let userId: string | undefined;
  try {
    const decoded: any = jwt.decode(access_token);
    userId = decoded?.sub;
    if (!userId) throw new Error('sub missing');
  } catch (err) {
    res.status(401).json({ message: 'Invalid access token' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: new_password,
    });

    if (error) {
      console.error('Admin update error', error);
      res.status(400).json({ message: error.message || 'Failed to change password' });
      return;
    }

    res.status(200).json({ message: 'Password changed successfully' });
    return;
  } catch (err: any) {
    console.error('changePassword error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const authorize = async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const accessToken = authHeader?.split(' ')[1];

  if (!accessToken) {
    res.status(401).json({ message: 'Access token missing' });
    return;
  }

  try {
    const { data: userData, error } = await supabase.auth.getUser(accessToken);

    if (error || !userData.user) {
      console.warn('Authorization failed:', error?.message || 'No user data found.');
      res.status(401).json({ message: 'Unauthorized: Invalid or expired access token.' });
      return;
    }

    res.status(200).json({
      authenticated: true,
      user: {
        id: userData.user.id,
        email: userData.user.email,
      }
    });

  } catch (err: any) {
    console.error('Error in authorize route:', err.message || err);
    // Catch any unexpected errors during token processing
    res.status(500).json({ message: 'Internal server error during authorization.' });
  }
};

//handle OAuth user (Google, etc.)
export const handleOAuthUser = async (req: Request, res: Response): Promise<void> => {
  const isMobileApp = req.headers['x-client-type'] === 'Mobile';
  const authHeader = req.headers.authorization;
  const access_token = authHeader?.split(' ')[1];

  if (!access_token) {
    res.status(401).json({ message: 'Access token required' });
    return;
  }

  try {
    // Get user from Supabase auth
    const { data: userData, error: userError } = await supabase.auth.getUser(access_token);

    if (userError || !userData?.user) {
      console.error('OAuth user validation error:', userError);
      res.status(401).json({ message: 'Invalid access token' });
      return;
    }

    const supabaseUser = userData.user;
    // console.log('OAuth user:', supabaseUser.email);

    // Check if user exists in our users table by ID
    let { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
      .eq('id', supabaseUser.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching user by ID:', fetchError);
    }

    // If not found by ID, check by email (user might have registered with email/password before)
    if (!existingUser && supabaseUser.email) {
      const { data: emailUser, error: emailError } = await supabaseAdmin
        .from('users')
        .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
        .eq('email', supabaseUser.email)
        .maybeSingle();

      if (emailError) {
        console.error('Error fetching user by email:', emailError);
      }

      if (emailUser) {
        // console.log('Found existing user by email, updating ID to link OAuth account');
        
        // Update the existing user's ID to match the new Supabase OAuth ID
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ id: supabaseUser.id })
          .eq('email', supabaseUser.email);

        if (updateError) {
          console.error('Error linking OAuth account:', updateError);
          // If we can't update the ID, just use the existing user data
          existingUser = emailUser;
        } else {
          // Fetch the updated user
          const { data: updatedUser } = await supabaseAdmin
            .from('users')
            .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
            .eq('id', supabaseUser.id)
            .maybeSingle();
          
          existingUser = updatedUser || emailUser;
          // console.log('OAuth account linked successfully for:', emailUser.username);
        }
      }
    }

    let userDetails = existingUser;

    // If user doesn't exist, create them
    if (!existingUser) {
      // console.log('Creating new OAuth user:', supabaseUser.email);

      // Generate username from email or OAuth name
      let username = supabaseUser.user_metadata?.full_name?.replace(/\s+/g, '_').toLowerCase() 
                     || supabaseUser.email?.split('@')[0] 
                     || `user_${Date.now()}`;

      // Check if username already exists
      const { data: usernameCheck } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      // If username exists, append random numbers
      if (usernameCheck) {
        username = `${username}_${Math.floor(Math.random() * 9999)}`;
      }

      const newUser = {
        id: supabaseUser.id,
        email: supabaseUser.email,
        username: username,
        fullname: supabaseUser.user_metadata?.full_name || '',
        avatar_url: supabaseUser.user_metadata?.avatar_url || null,
        status: 'offline',
        bio: '',
        date_of_birth: null,
      };

      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert([newUser]);

      if (insertError) {
        console.error('Error creating OAuth user:', insertError);
        res.status(500).json({ message: 'Failed to create user record' });
        return;
      }

      // Fetch the newly created user
      const { data: newUserData } = await supabaseAdmin
        .from('users')
        .select('id, email, username, fullname, avatar_url, bio, date_of_birth, status, created_at')
        .eq('id', supabaseUser.id)
        .maybeSingle();

      userDetails = newUserData;
      // console.log('OAuth user created successfully:', username);
    } else {
      // console.log('Existing user found:', existingUser.username);
      
      // Optionally update avatar if user doesn't have one
      if (!existingUser.avatar_url && supabaseUser.user_metadata?.avatar_url) {
        await supabaseAdmin
          .from('users')
          .update({ avatar_url: supabaseUser.user_metadata.avatar_url })
          .eq('id', supabaseUser.id);
        
        userDetails = { ...existingUser, avatar_url: supabaseUser.user_metadata.avatar_url };
      }
    }

    // Get refresh token from session
    const { data: sessionData } = await supabase.auth.getSession();
    const refresh_token = sessionData?.session?.refresh_token || '';

    if (isMobileApp) {
      res.status(200).json({
        message: 'OAuth login successful',
        user: userDetails,
        accessToken: access_token,
        refreshToken: refresh_token,
        isNewUser: !existingUser,
      });
    } else {
      res.cookie('access_token', access_token, cookieOptions);
      if (refresh_token) {
        res.cookie('refresh_token', refresh_token, {
          ...cookieOptions,
          maxAge: REFRESH_TOKEN_MAX_AGE,
        });
      }
      res.status(200).json({
        message: 'OAuth login successful',
        user: userDetails,
        accessToken: access_token,
        refreshToken: refresh_token,
        isNewUser: !existingUser,
      });
    }

  } catch (err: any) {
    console.error('OAuth handler error:', err);
    res.status(500).json({ message: 'Server error during OAuth login' });
  }
};
