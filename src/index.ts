import { Hono } from "hono";
import type { Env } from "./bindings";
import { authMiddleware } from "./auth";
import { sessionRoutes } from "./api/session";
import { taskRoutes } from "./api/tasks";
import { logRoutes } from "./api/logs";
import { overviewRoute } from "./api/overview";
import { runDueTasks } from "./cron/runner";

const app = new Hono<{ Bindings: Env }>();

// 健康检查（无需鉴权）
app.get("/api/health", (c) => c.json({ ok: true }));

// 鉴权路由
app.post("/api/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (!password || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: "invalid_password" }, 401);
  }
  const expiry = Date.now() + 7 * 24 * 3600 * 1000; // 7天
  const key = new TextEncoder().encode(c.env.ADMIN_PASSWORD);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(String(expiry)));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const cookie = `auth=${expiry}.${hex}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
  c.header("Set-Cookie", cookie);
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  c.header("Set-Cookie", "auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  return c.json({ ok: true });
});

// 鉴权中间件保护 /api/* 路由（login、logout、health 除外）
app.use("/api/*", authMiddleware);

// API 路由
app.route("/api/session", sessionRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/logs", logRoutes);
app.route("/api", overviewRoute);

// 静态资源回退（放在所有 /api 路由之后）
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runDueTasks(env).catch((err) => {
        console.error("scheduled error:", err?.message || err);
      })
    );
  },
};
