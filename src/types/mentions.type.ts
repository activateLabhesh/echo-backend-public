
export type MentionNotificationRecord = {
  id: string;
  user_id: string;
  message_id: string;
  is_read: boolean;
  created_at: string;
};

export type MentionMessageRecord = {
  id: string;
  content: string | null;
  sender_id: string | null;
  channel_id: string | null;
};

export type MentionUserRecord = {
  id?: string;
  username: string | null;
  avatar_url: string | null;
};

export type MentionChannelRecord = {
  id?: string;
  name: string | null;
  server_id: string | null;
};

export type MentionServerRecord = {
  id?: string;
  name: string | null;
};

export type MentionMemberRecord = {
  user_id: string;
};

export type MentionableUserRecord = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  fullname: string | null;
};