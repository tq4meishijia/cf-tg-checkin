# TG Checkin Worker

基于 Cloudflare Workers 免费计划的 Telegram 自动签到工具：模拟用户态账号，定时向指定 Telegram 机器人发送指令（如 `/checkin`），自带 Web 管理界面。

完整设计见 `PLAN.md`。

## 架构

```
Cron(* * * * *) → cron/runner 扫 tasks 表 due 任务 → GramJS connect → sendMessage → disconnect
                     ↓ 写 run_logs / 重算 next_run_at
浏览器 → Hono API(/api/*，HMAC Cookie 鉴权) → D1(settings/tasks/run_logs)
       → Static Assets(public/ 原生 SPA)
```

- 调度不依赖 cron 表达式解析，靠 `next_run_at` 字段；补跑容忍 30 分钟，超时跳过。
- 登录拿 session 只在本地脚本做；Worker 里只用已保存的 StringSession `connect()`，绝不 `start()`。
- session 字符串只存 D1，任何 API 都不返回给前端。

## 本地开发

```bash
# 依赖（Node >= 22）
npm install

# 配置本地环境变量（参考 .dev.vars.example 填入真实值）
cp .dev.vars.example .dev.vars

# 建本地库结构
npx wrangler d1 migrations apply tg-checkin-db --local

# 起开发服务
npm run dev          # http://127.0.0.1:8787
# 手动触发一次 cron：
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"

# 校验
npm run typecheck
npm test
```

## 拿 Telegram Session（M1 闸门，需要交互）

1. 在 https://my.telegram.org/apps 用小号申请 `api_id` / `api_hash`，填进 `.dev.vars`。
2. 运行 `node --env-file=.dev.vars scripts/login.mjs`，按提示输手机号、短信验证码、二步密码。
3. 终端输出 `SESSION=1...` 长串。
4. 启动 `npm run dev` 后打开管理界面，登录（密码 = `.dev.vars` 里的 `ADMIN_PASSWORD`）→ 设置页粘贴 session 保存。

## 部署上线（M6）

```bash
npx wrangler login
npx wrangler d1 create tg-checkin-db        # 把输出的 database_id 填回 wrangler.toml
npx wrangler d1 migrations apply tg-checkin-db --remote
npx wrangler secret put TG_API_ID
npx wrangler secret put TG_API_HASH
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

上线后到 Cloudflare 面板 Worker → 触发器 等真实整分钟 cron（约有几十秒抖动），线上不能用 `/__scheduled`。

## 常见问题

- **session 失效**：设置页会显示"已配置但无法验证"，清除后重新跑 `scripts/login.mjs` 粘贴新 session。
- **cron 不触发**：本地用 `/cdn-cgi/local/scheduled` 手动触发验证；线上到 Cloudflare 面板确认 Trigger 已注册、Worker Metrics 里看 invocations。
- **CPU 超限**：面板 Metrics 看 `exceededCpu`；免费版 cron 仅 10ms CPU 预算，单条消息一般够，偶发超限由 isolate 弹性吸收。
- **封号风险**：userbot 游走 Telegram ToS 边缘，请用小号、低频、开二步验证、加随机抖动。
