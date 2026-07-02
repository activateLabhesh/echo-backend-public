import { supabase, supabaseAdmin } from '../client/supabase';

const FRONTEND_URL = process.env.FRONTEND_URL?.split(',')[0]?.trim();

export async function existingUser(email: string) {
    const { data: existingEmail } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

    if (existingEmail) {
        return true;
    }
    return false;
}

export async function existingUserName(username: string) {
    const { data: existingUsername } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

    if (existingUsername) {
        return true;
    }
    return false;
}

export async function registerAuth(email: string, password: string) {
    const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: `${FRONTEND_URL}/auth/callback?next=/login`,
        },
    });

    if (error || !signUpData?.user?.id) {
        throw new Error(error?.message || 'Failed to register user');
    }
}