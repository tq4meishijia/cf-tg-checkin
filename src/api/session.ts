import { Hono } from "hono";
import type { Env } from "../bindings";
import { getSetting, setSetting, deleteSetting } from "../db";
import { withClient } from "../tg/client";

export const sessionRoutes = new Hono<{ Bindings: Env }>();

// GET /api/session — 状态查询，不返回 session 字符串
sessionRoutes.get("/", async (c) => {
  const sessionStr = await getSetting(c.env, "tg_session");
  if (!sessionStr) {
    return c.json({ configured: false });
  }

  try {
    const me = await withClient(c.env, async (client) => client.getMe());
    const user = me as any;
    return c.json({
      configured: true,
      account: {
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        username: user.username || null,
        phone: user.phone || null,
      },
    });
  } catch (err: any) {
    return c.json({
      configured: true,
      account: null,
      error: err?.message || "invalid_session",
    });
  }
});

// PUT /api/session — 保存 session 并验证
sessionRoutes.put("/", async (c) => {
  const { session } = await c.req.json<{ session: string }>();
  if (!session || typeof session !== "string") {
    return c.json({ error: "session string required" }, 400);
  }

  // 先验证 session 有效性
  try {
    const me = await withClientForSession(c.env, session, async (client) => client.getMe());
    const user = me as any;
    await setSetting(c.env, "tg_session", session);
    return c.json({
      ok: true,
      account: {
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        username: user.username || null,
        phone: user.phone || null,
      },
    });
  } catch (err: any) {
    return c.json({ error: err?.message || "invalid_session" }, 400);
  }
});

// DELETE /api/session — 清除
sessionRoutes.delete("/", async (c) => {
  await deleteSetting(c.env, "tg_session");
  return c.json({ ok: true });
});

/** 用指定的 session 字符串（而非 D1 中存储的）创建临时客户端 */
async function withClientForSession<T>(
  env: Env,
  sessionStr: string,
  fn: (client: any) => Promise<T>
): Promise<T> {
  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions");
  const client = new TelegramClient(
    new StringSession(sessionStr),
    Number(env.TG_API_ID),
    env.TG_API_HASH,
    { connectionRetries: 3, autoReconnect: false }
  );
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}
