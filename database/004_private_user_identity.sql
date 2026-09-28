BEGIN;

-- Remove the internal UUID fragment from legacy generated names only.
-- Sessions, history ownership, and user-chosen names remain intact.
UPDATE tarot_users SET nickname = '星旅人'
WHERE nickname = '星旅人_' || left(id::text, 8);

-- The legacy profile_id column is retained for data compatibility but is no
-- longer exposed or editable. Display names live in nickname and may repeat.
COMMIT;
