CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quizzes (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  class_name TEXT NOT NULL,
  quiz_date DATE NOT NULL,
  teacher_name TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single','multi','truefalse','matching','ordering')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS questions (
  id BIGSERIAL PRIMARY KEY,
  quiz_id BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'single' CHECK (question_type IN ('single','multi','truefalse','matching','ordering')),
  prompt TEXT NOT NULL,
  image_url TEXT,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_key JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quiz_id, position)
);

CREATE TABLE IF NOT EXISTS participants (
  id BIGSERIAL PRIMARY KEY,
  quiz_id BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','locked')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Names are display labels, not unique identities. Keep a non-unique index for admin sorting/search.
DROP INDEX IF EXISTS participants_unique_name_per_quiz;
CREATE INDEX IF NOT EXISTS participants_name_per_quiz_idx ON participants(quiz_id, LOWER(display_name));
CREATE INDEX IF NOT EXISTS participants_quiz_status_idx ON participants(quiz_id, status);

CREATE TABLE IF NOT EXISTS attempts (
  id BIGSERIAL PRIMARY KEY,
  participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC(5,2),
  question_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  state TEXT NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress','submitted','locked')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_attempt_per_participant ON attempts(participant_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS attempts_participant_idx ON attempts(participant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_event_created_idx ON audit_log(event, created_at DESC);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  original_name TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backward-compatible migration for existing local databases.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type TEXT;
UPDATE questions SET question_type = quizzes.question_type FROM quizzes WHERE questions.quiz_id = quizzes.id AND (questions.question_type IS NULL OR questions.question_type = '');
ALTER TABLE questions ALTER COLUMN question_type SET DEFAULT 'single';
ALTER TABLE questions ALTER COLUMN question_type SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_question_type_check') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_question_type_check CHECK (question_type IN ('single','multi','truefalse','matching','ordering'));
  END IF;
END $$;
