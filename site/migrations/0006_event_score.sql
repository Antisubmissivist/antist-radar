-- Persona relevance score per event (0-100), set by the AI pre-selection pass.
ALTER TABLE events ADD COLUMN score INTEGER;
