import { Hono } from "hono";
import type { Env } from "../bindings";
import { getSetting } from "../db";

export const overviewRoute = new Hono<{ Bindings: Env }>();

// GET /api/overview — 仪表盘数据
overviewRoute.get("/overview", async (c) => {
  const today = new Date().toISOString().slice(0, 10);

  // 今日成功/失败/skipped 计数
  const stats = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count FROM run_logs
     WHERE created_at >= ? GROUP BY status`
  ).bind(today).all<{ status: string; count: number }>();

  const counts: Record<string, number> = { success: 0, failed: 0, skipped: 0 };
  for (const row of stats.results) {
    counts[row.status] = row.count;
  }

  // 未来 24h 待执行任务（enabled + next_run_at 在未来 24h 内）
  // 注意：next_run_at 存 ISO 'T' 格式，不能和 datetime('now') 的空格格式直接比字符串，
  // 必须用 JS 生成同样 ISO 格式的上界再绑定。
  const bound = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const upcoming = await c.env.DB.prepare(
    `SELECT id, name, bot_username, command, next_run_at FROM tasks
     WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
     ORDER BY next_run_at ASC LIMIT 5`
  ).bind(bound).all();

  // session 状态
  const sessionStr = await getSetting(c.env, "tg_session");

  return c.json({
    today: counts,
    upcoming: upcoming.results,
    sessionConfigured: !!sessionStr,
  });
});
