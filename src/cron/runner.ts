import type { Env } from "../bindings";
import { withClient } from "../tg/client";
import { computeNextRun } from "./schedule";

const MAX_TASKS_PER_RUN = 10;
const TASK_TIMEOUT_MS = 25000;
const MAX_LATE_MINUTES = 30;

interface DueTask {
  id: number;
  name: string;
  bot_username: string;
  command: string;
  schedule_type: string;
  schedule_value: string;
  timezone: string;
  jitter_minutes: number;
  capture_reply: number;
  reply_wait_sec: number;
  next_run_at: string;
}

export async function runDueTasks(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    `SELECT * FROM tasks WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?`
  ).bind(now, MAX_TASKS_PER_RUN).all<DueTask>();

  for (const task of rows.results) {
    await executeOneTask(env, task);
  }

  // 1% 概率清理 30 天前日志
  if (Math.random() < 0.01) {
    await env.DB.prepare(
      "DELETE FROM run_logs WHERE created_at < datetime('now', '-30 days')"
    ).run();
  }
}

/**
 * 执行单个任务。
 * opts.manual = true 表示来自「立即运行」：
 *   - 不做「落后 30 分钟跳过重排」判断；
 *   - 不做乐观锁占位；
 *   - 执行后不重算/改写 next_run_at（不影响原排期）。
 */
export async function executeOneTask(
  env: Env,
  task: DueTask,
  opts: { manual?: boolean } = {}
): Promise<{ status: string; detail: string }> {
  const startedAt = Date.now();

  // 仅 cron 触发时执行：落后超过 30 分钟直接跳过重排
  if (!opts.manual) {
    const lateMs = Date.now() - new Date(task.next_run_at).getTime();
    if (lateMs > MAX_LATE_MINUTES * 60000) {
      const next = computeNextRun(
        {
          scheduleType: task.schedule_type as "daily" | "interval",
          scheduleValue: task.schedule_value,
          timezone: task.timezone,
          jitterMinutes: task.jitter_minutes,
        },
        new Date()
      );
      await env.DB.prepare(
        "UPDATE tasks SET next_run_at=?, updated_at=datetime('now') WHERE id=?"
      ).bind(next?.toISOString() ?? null, task.id).run();

      await env.DB.prepare(
        "INSERT INTO run_logs(task_id, status, detail, duration_ms) VALUES(?, ?, ?, ?)"
      ).bind(task.id, "skipped", "missed,rescheduled", 0).run();

      return { status: "skipped", detail: "missed,rescheduled" };
    }

    // 乐观锁：先把 next_run_at 置空，防并发重跑
    const claim = await env.DB.prepare(
      "UPDATE tasks SET next_run_at=NULL WHERE id=? AND next_run_at=?"
    ).bind(task.id, task.next_run_at).run();

    if (claim.meta.changes === 0) {
      return { status: "skipped", detail: "already_claimed" };
    }
  }

  // 25 秒超时包装
  let status = "success";
  let detail = "";

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("task_timeout_25s")), TASK_TIMEOUT_MS)
  );

  const workPromise = (async () => {
    try {
      const result = await withClient(env, async (client) => {
        // 发送消息
        const target = task.bot_username === "me" ? "me" : task.bot_username;
        await client.sendMessage(target, { message: task.command });

        // 可选：等待并抓取机器人回复（取最新一条「非自己发」的消息）
        let replyDetail = "";
        if (task.capture_reply && task.reply_wait_sec > 0) {
          await new Promise((r) => setTimeout(r, task.reply_wait_sec * 1000));
          try {
            const messages = await client.getMessages(target, { limit: 10 });
            const reply = (messages as any[]).find((m) => !m.out);
            if (reply) {
              replyDetail = (reply.message || "").slice(0, 500);
            }
          } catch {
            replyDetail = "[failed to capture reply]";
          }
        }
        return replyDetail;
      });
      detail = result;
    } catch (err: any) {
      status = "failed";
      detail = (err?.message || String(err)).slice(0, 500);
    }
  })();

  try {
    await Promise.race([workPromise, timeoutPromise]);
  } catch (err: any) {
    if (status === "success") {
      status = "failed";
      detail = (err?.message || String(err)).slice(0, 500);
    }
  }

  const durationMs = Date.now() - startedAt;

  // 写日志
  await env.DB.prepare(
    "INSERT INTO run_logs(task_id, status, detail, duration_ms) VALUES(?, ?, ?, ?)"
  ).bind(task.id, status, detail, durationMs).run();

  // 更新 task 状态
  await env.DB.prepare(
    "UPDATE tasks SET last_run_at=datetime('now'), last_status=?, last_error=?, updated_at=datetime('now') WHERE id=?"
  ).bind(status, status === "failed" ? detail : null, task.id).run();

  // 仅 cron 触发时重排 next_run_at（手动运行不影响排期）
  if (!opts.manual) {
    const next = computeNextRun(
      {
        scheduleType: task.schedule_type as "daily" | "interval",
        scheduleValue: task.schedule_value,
        timezone: task.timezone,
        jitterMinutes: task.jitter_minutes,
      },
      new Date()
    );

    await env.DB.prepare(
      "UPDATE tasks SET next_run_at=?, updated_at=datetime('now') WHERE id=?"
    ).bind(next?.toISOString() ?? null, task.id).run();
  }

  return { status, detail };
}
