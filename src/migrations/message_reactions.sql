-- Message Reactions Migration
-- Stores emoji reactions for channel messages and DM messages.

CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  dm_message_id UUID REFERENCES dm_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT message_reactions_target_check CHECK (
    (message_id IS NOT NULL AND dm_message_id IS NULL)
    OR
    (message_id IS NULL AND dm_message_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reactions_unique_channel
  ON message_reactions(message_id, user_id, emoji)
  WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reactions_unique_dm
  ON message_reactions(dm_message_id, user_id, emoji)
  WHERE dm_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_dm_message_id ON message_reactions(dm_message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user_id ON message_reactions(user_id);
