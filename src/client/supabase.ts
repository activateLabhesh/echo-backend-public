import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.SUPABASE_URL) {
  throw new Error('Missing SUPABASE_URL environment variable');
}

if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_ANON_KEY environment variable');
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

// Regular client for normal operations
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true
    }
  }
);

// Service role client for admin operations
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: true
    }
  }
);

// Optional: Test connection function (call this when needed, not on import)
export const testConnection = async () => {
  try {
    await supabase.from('users').select('count').single();
    console.log('✅ Successfully connected to Supabase database');
    return true;
  } catch (error: unknown) {
    console.error('❌ Failed to connect to Supabase database:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}; 