-- Mirror Supabase Auth users into public.users

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  generated_username TEXT;
BEGIN
  generated_username := COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'user') || '_' || substr(NEW.id::text, 1, 8);

  INSERT INTO public.users (
    id,
    email,
    username,
    fullname,
    avatar_url,
    status,
    bio,
    date_of_birth
  )
  VALUES (
    NEW.id,
    NEW.email,
    generated_username,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'avatar_url', ''),
    'offline',
    '',
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    username = EXCLUDED.username,
    fullname = EXCLUDED.fullname,
    avatar_url = COALESCE(EXCLUDED.avatar_url, avatar_url),
    status = COALESCE(status, EXCLUDED.status),
    bio = COALESCE(EXCLUDED.bio, bio),
    date_of_birth = COALESCE(EXCLUDED.date_of_birth, date_of_birth);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Backfill existing auth users that are missing from public.users.
INSERT INTO public.users (
  id,
  email,
  username,
  fullname,
  
  avatar_url,
  status,
  bio,
  date_of_birth
)
SELECT
  au.id,
  au.email,
  COALESCE(NULLIF(split_part(au.email, '@', 1), ''), 'user') || '_' || substr(au.id::text, 1, 8),
  COALESCE(au.raw_user_meta_data ->> 'full_name', ''),
  NULLIF(au.raw_user_meta_data ->> 'avatar_url', ''),
  'offline',
  '',
  NULL
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL;
