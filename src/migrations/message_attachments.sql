-- Message Attachments Migration
-- Adds scalable attachment metadata for channel and DM messages.

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  attachment_type VARCHAR(16) NOT NULL CHECK (attachment_type IN ('image', 'audio', 'file')),
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_type ON message_attachments(attachment_type);

CREATE TABLE IF NOT EXISTS dm_message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dm_message_id UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  attachment_type VARCHAR(16) NOT NULL CHECK (attachment_type IN ('image', 'audio', 'file')),
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_message_attachments_message_id ON dm_message_attachments(dm_message_id);
CREATE INDEX IF NOT EXISTS idx_dm_message_attachments_type ON dm_message_attachments(attachment_type);
