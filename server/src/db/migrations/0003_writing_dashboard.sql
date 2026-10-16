CREATE TABLE writing_days (
  day TEXT PRIMARY KEY,
  words INTEGER NOT NULL CHECK (words >= 0)
) STRICT;
CREATE TABLE writing_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  daily_goal INTEGER NOT NULL CHECK (daily_goal BETWEEN 1 AND 1000000)
) STRICT;
INSERT INTO writing_settings(id, daily_goal) VALUES (1, 2000);
