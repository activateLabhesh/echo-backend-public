-- Channel Categories Migration
-- This migration adds support for channel categories (like Discord)

-- 1. Create channel_categories table
CREATE TABLE IF NOT EXISTS channel_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_channel_categories_server ON channel_categories(server_id);

-- 2. Add category_id and position columns to channels table
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES channel_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;

-- Create index for channel category lookups
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id);

-- 3. Create function to generate default categories for new servers
CREATE OR REPLACE FUNCTION create_default_channel_categories()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO channel_categories (server_id, name, position)
  VALUES 
    (NEW.id, 'Text Channels', 0),
    (NEW.id, 'Voice Channels', 1);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger to auto-create default categories when a new server is created
DROP TRIGGER IF EXISTS on_server_created_add_categories ON servers;
CREATE TRIGGER on_server_created_add_categories
AFTER INSERT ON servers
FOR EACH ROW EXECUTE FUNCTION create_default_channel_categories();

-- 5. Migration for existing servers: Add default categories
-- This inserts default categories for servers that don't have any
INSERT INTO channel_categories (server_id, name, position)
SELECT s.id, 'Text Channels', 0
FROM servers s
WHERE NOT EXISTS (
  SELECT 1 FROM channel_categories cc WHERE cc.server_id = s.id
);

INSERT INTO channel_categories (server_id, name, position)
SELECT s.id, 'Voice Channels', 1
FROM servers s
WHERE NOT EXISTS (
  SELECT 1 FROM channel_categories cc 
  WHERE cc.server_id = s.id AND cc.name = 'Voice Channels'
);

-- 6. Assign existing channels to appropriate default categories based on type
-- First, assign text channels to "Text Channels" category
UPDATE channels c
SET category_id = (
  SELECT cc.id 
  FROM channel_categories cc 
  WHERE cc.server_id = c.server_id AND cc.name = 'Text Channels'
  LIMIT 1
)
WHERE c.category_id IS NULL AND c.type = 'text';

-- Then, assign voice channels to "Voice Channels" category
UPDATE channels c
SET category_id = (
  SELECT cc.id 
  FROM channel_categories cc 
  WHERE cc.server_id = c.server_id AND cc.name = 'Voice Channels'
  LIMIT 1
)
WHERE c.category_id IS NULL AND c.type = 'voice';

-- 7. Set initial positions for channels within their categories
WITH ranked_channels AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY created_at) - 1 as new_position
  FROM channels
  WHERE category_id IS NOT NULL
)
UPDATE channels c
SET position = rc.new_position
FROM ranked_channels rc
WHERE c.id = rc.id;
