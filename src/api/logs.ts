import { Hono } from "hono";
import type { Env } from "../bindings";

export const logRoutes = new Hono<{ Bindings: Env }>();

// GET /api/logs?task_id=&limit=&before_id=
logRoutes.get("/", async (c) => {
  const taskId = c.req.query("task_id");
  const limit = Math.min(Number(c.req.query("limit") || "50"), 100);
  const beforeId = c.req.query("before_id");

  let sql = "SELECT l.*, t.name as task_name FROM run_logs l LEFT JOIN tasks t ON l.task_id = t.id";
  const conditions: string[] = [];
  const params: any[] = [];

  if (taskId) {
    conditions.push("l.task_id = ?");
    params.push(Number(taskId));
  }
  if (beforeId) {
    conditions.push("l.id < ?");
    params.push(Number(beforeId));
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY l.id DESC LIMIT ?";
  params.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ logs: rows.results });
});
