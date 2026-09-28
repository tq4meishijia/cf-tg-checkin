import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import type { Env } from "../bindings";
import { getSetting } from "../db";

/**
 * 从 D1 读取 session，创建 TelegramClient，connect，执行 fn，然后 disconnect。
 * 注意：只调 connect()，绝不调 start()。
 */
export async function withClient<T>(
  env: Env,
  fn: (client: TelegramClient) => Promise<T>
): Promise<T> {
  const sessionStr = await getSetting(env, "tg_session");
  if (!sessionStr) {
    throw new Error("tg_session not configured");
  }

  const client = new TelegramClient(
    new StringSession(sessionStr),
    Number(env.TG_API_ID),
    env.TG_API_HASH,
    {
      connectionRetries: 3,
      autoReconnect: false,
    }
  );

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}
