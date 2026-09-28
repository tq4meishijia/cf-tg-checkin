/**
 * 本地登录脚本（非交互模式，供 Agent 驱动）
 *
 * 用法：
 *   node --env-file=.dev.vars scripts/login.mjs
 * 环境变量：
 *   TG_PHONE       手机号（含国际区号，如 +86...）
 *   TG_2FA         二步验证密码（无则留空）
 *   TG_CODE_FILE   验证码文件路径（默认 .tg_code.txt），脚本轮询该文件出现的第一行作为验证码
 *   TG_PROXY_HOST / TG_PROXY_PORT  SOCKS5 代理（默认 127.0.0.1:7897）
 * 成功后输出 SESSION=xxx。
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import fs from "fs";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const phone = process.env.TG_PHONE;

if (!apiId || !apiHash || !phone) {
  console.error("需要环境变量 TG_API_ID / TG_API_HASH / TG_PHONE");
  process.exit(1);
}

const codeFile = process.env.TG_CODE_FILE || ".tg_code.txt";
if (fs.existsSync(codeFile)) fs.unlinkSync(codeFile);

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
  // 本机 GFW 环境下直连 Telegram DC 会超时，走 Clash 混合端口（SOCKS5）。
  proxy: {
    ip: process.env.TG_PROXY_HOST || "127.0.0.1",
    port: Number(process.env.TG_PROXY_PORT || 7897),
    socksType: 5,
  },
});

async function waitForCode(timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const s = fs.readFileSync(codeFile, "utf8").trim();
      if (s) return s;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("等待验证码超时（5 分钟）");
}

async function main() {
  await client.connect();
  console.log("[driver] connected, sending code request...");

  await client.start({
    phoneNumber: async () => phone,
    phoneCode: async () => {
      console.log("[driver] waiting for code in " + codeFile);
      return await waitForCode();
    },
    password: async () => process.env.TG_2FA || "",
    onError: (err) => console.error("登录错误:", err?.message || err),
  });

  const session = client.session.save();
  console.log("\n登录成功！\n");
  console.log("SESSION=" + session);

  try {
    const me = await client.getMe();
    console.log(`\n账号: ${me.firstName || ""} ${me.lastName || ""} (@${me.username || "N/A"})`);
  } catch {}

  await client.disconnect();
}

main().catch((err) => {
  console.error("失败:", err?.message || err);
  process.exit(1);
});
