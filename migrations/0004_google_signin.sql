-- Migration: 0004_google_signin.sql
-- Profile columns for "Continue with Google" sign-in.
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN picture TEXT;
ALTER TABLE users ADD COLUMN google_sub TEXT;

