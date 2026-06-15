-- Message Pins Migration
-- Stores pin state for channel messages and DM messages.

CREATE TABLE IF NOT EXISTS message_pins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  dm_message_id UUID REFERENCES dm_messages(id) ON DELETE CASCADE,
  pinned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT message_pins_target_check CHECK (
    (message_id IS NOT NULL AND dm_message_id IS NULL)
    OR
    (message_id IS NULL AND dm_message_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_pins_unique_channel
  ON message_pins(message_id)
  WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_pins_unique_dm
  ON message_pins(dm_message_id)
  WHERE dm_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_pins_message_id ON message_pins(message_id);
CREATE INDEX IF NOT EXISTS idx_message_pins_dm_message_id ON message_pins(dm_message_id);
CREATE INDEX IF NOT EXISTS idx_message_pins_pinned_by ON message_pins(pinned_by);
