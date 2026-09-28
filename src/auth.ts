import { createMiddleware } from "hono/factory";
import type { Env } from "./bindings";

// 不需要鉴权的路径
const SKIP_AUTH = ["/api/login", "/api/logout", "/api/health"];

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (SKIP_AUTH.includes(path)) {
    return next();
  }

  const cookie = c.req.header("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)auth=([^;]+)/);
  if (!match) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const [expiryStr, sig] = match[1].split(".");
  const expiry = Number(expiryStr);
  if (!expiry || Date.now() > expiry) {
    return c.json({ error: "expired" }, 401);
  }

  // 验证 HMAC 签名
  const key = new TextEncoder().encode(c.env.ADMIN_PASSWORD);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const expected = await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(expiryStr)
  );
  const expectedHex = [...new Uint8Array(expected)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  if (sig !== expectedHex) {
    return c.json({ error: "invalid_signature" }, 401);
  }

  return next();
});
