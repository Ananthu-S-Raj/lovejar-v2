-- Adds the `kind` column to chat_messages for the Hug/Kiss affection messages.
-- Required only for databases created before this feature (schema.sql already
-- includes the column for fresh databases). Run once against an existing D1
-- database: `npm run db:migrate:upgrade`
-- Backwards compatible: existing rows default to 'text'.

ALTER TABLE chat_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
