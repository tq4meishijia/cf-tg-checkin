-- 键值配置：tg_session（StringSession 字符串）、未来扩展项
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  bot_username   TEXT NOT NULL,
  command        TEXT NOT NULL,
  schedule_type  TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  timezone       TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  jitter_minutes INTEGER NOT NULL DEFAULT 0,
  capture_reply  INTEGER NOT NULL DEFAULT 0,
  reply_wait_sec INTEGER NOT NULL DEFAULT 10,
  enabled        INTEGER NOT NULL DEFAULT 1,
  next_run_at    TEXT,
  last_run_at    TEXT,
  last_status    TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_due ON tasks(enabled, next_run_at);

CREATE TABLE run_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  detail      TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_logs_task ON run_logs(task_id, id DESC);
