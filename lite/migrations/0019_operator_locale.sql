-- The dashboard language an operator chose (one of src/office/locales.ts). NULL follows the
-- browser's language.
ALTER TABLE operator ADD COLUMN locale TEXT;
