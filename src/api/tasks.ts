import { Hono } from "hono";
import type { Env } from "../bindings";
import { computeNextRun } from "../cron/schedule";
import { executeOneTask } from "../cron/runner";

export const taskRoutes = new Hono<{ Bindings: Env }>();

// GET /api/tasks — 列表
taskRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM tasks ORDER BY id ASC"
  ).all();
  return c.json({ tasks: rows.results });
});

// POST /api/tasks — 新建
taskRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const {
    name, bot_username, command, schedule_type, schedule_value,
    timezone = "Asia/Shanghai", jitter_minutes = 0,
    capture_reply = 0, reply_wait_sec = 10, enabled = 1,
  } = body;

  // 字段校验
  if (!name || !bot_username || !command || !schedule_type || !schedule_value) {
    return c.json({ error: "missing_required_fields" }, 400);
  }
  if (!["daily", "interval"].includes(schedule_type)) {
    return c.json({ error: "invalid_schedule_type" }, 400);
  }
  if (schedule_type === "daily") {
    const times = schedule_value.split(",").map((s: string) => s.trim());
    if (!times.every((t: string) => /^\d{2}:\d{2}$/.test(t))) {
      return c.json({ error: "invalid_time_format" }, 400);
    }
  }
  if (schedule_type === "interval") {
    const mins = parseInt(schedule_value, 10);
    if (isNaN(mins) || mins < 1) {
      return c.json({ error: "interval_must_be_positive_integer" }, 400);
    }
  }

  const nextRun = computeNextRun(
    { scheduleType: schedule_type, scheduleValue: schedule_value, timezone, jitterMinutes: jitter_minutes },
    new Date()
  );

  const result = await c.env.DB.prepare(
    `INSERT INTO tasks(name, bot_username, command, schedule_type, schedule_value, timezone, jitter_minutes, capture_reply, reply_wait_sec, enabled, next_run_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, bot_username, command, schedule_type, schedule_value, timezone, jitter_minutes, capture_reply, reply_wait_sec, enabled, nextRun?.toISOString() ?? null).run();

  const id = result.meta.last_row_id;
  const task = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  return c.json({ task }, 201);
});

// GET /api/tasks/:id — 详情
taskRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const task = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return c.json({ error: "not_found" }, 404);
  return c.json({ task });
});

// PATCH /api/tasks/:id — 更新
taskRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<any>();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json();
  const fields = ["name", "bot_username", "command", "schedule_type", "schedule_value", "timezone", "jitter_minutes", "capture_reply", "reply_wait_sec", "enabled"];
  const updates: string[] = [];
  const values: any[] = [];

  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[f]);
    }
  }

  if (updates.length === 0) return c.json({ error: "no_fields_to_update" }, 400);

  // 如果改了排期相关字段，重算 next_run_at
  const scheduleChanged = ["schedule_type", "schedule_value", "timezone", "jitter_minutes"].some((f) => body[f] !== undefined);
  if (scheduleChanged) {
    const merged = { ...existing, ...body };
    const nextRun = computeNextRun(
      {
        scheduleType: merged.schedule_type as "daily" | "interval",
        scheduleValue: merged.schedule_value,
        timezone: merged.timezone,
        jitterMinutes: merged.jitter_minutes,
      },
      new Date()
    );
    updates.push("next_run_at = ?");
    values.push(nextRun?.toISOString() ?? null);
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  await c.env.DB.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();

  const task = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  return c.json({ task });
});

// DELETE /api/tasks/:id — 删除
taskRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// POST /api/tasks/:id/run — 立即执行一次
taskRoutes.post("/:id/run", async (c) => {
  const id = Number(c.req.param("id"));
  const task = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<any>();
  if (!task) return c.json({ error: "not_found" }, 404);

  const result = await executeOneTask(c.env, task as any, { manual: true });
  return c.json({ ok: true, ...result });
});
