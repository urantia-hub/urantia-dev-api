-- The French, German, Korean, Portuguese, and Dutch entity rows of March 2026 were made with the
-- Foundation text as context (Dutch also has rows from the Foundation). Kelson, 2026-10-29.
begin;
delete from entity_translations where language in ('fr', 'de', 'ko', 'pt', 'nl');
commit;
