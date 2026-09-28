import { describe, it, expect } from "vitest";
import { computeNextRun, localWallToUtc } from "../src/cron/schedule";

describe("localWallToUtc", () => {
  it("Asia/Shanghai 08:00 → UTC 前一天 00:00 (UTC+8)", () => {
    // 2025-06-15 08:00 CST = 2025-06-15 00:00 UTC
    const utc = localWallToUtc("2025-06-15", "08:00", "Asia/Shanghai");
    expect(utc.toISOString()).toBe("2025-06-15T00:00:00.000Z");
  });

  it("Asia/Shanghai 20:00 → UTC 12:00", () => {
    const utc = localWallToUtc("2025-06-15", "20:00", "Asia/Shanghai");
    expect(utc.toISOString()).toBe("2025-06-15T12:00:00.000Z");
  });

  it("UTC 时区无偏移", () => {
    const utc = localWallToUtc("2025-06-15", "12:00", "UTC");
    expect(utc.toISOString()).toBe("2025-06-15T12:00:00.000Z");
  });

  it("America/New_York 09:00 → UTC 13:00 (UTC-4 夏令时)", () => {
    // 2025-06-15 纽约 EDT (UTC-4)
    const utc = localWallToUtc("2025-06-15", "09:00", "America/New_York");
    expect(utc.toISOString()).toBe("2025-06-15T13:00:00.000Z");
  });
});

describe("computeNextRun - daily", () => {
  it("下一个 08:00 CST", () => {
    // from = 2025-06-14 23:00 UTC = 2025-06-15 07:00 CST
    const from = new Date("2025-06-14T23:00:00Z");
    const next = computeNextRun(
      { scheduleType: "daily", scheduleValue: "08:00", timezone: "Asia/Shanghai", jitterMinutes: 0 },
      from
    );
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2025-06-15T00:00:00.000Z");
  });

  it("多个时间点 08:00,20:00 CST，当前 07:30 CST → 返回 08:00", () => {
    // from = 2025-06-14 23:30 UTC = 2025-06-15 07:30 CST
    const from = new Date("2025-06-14T23:30:00Z");
    const next = computeNextRun(
      { scheduleType: "daily", scheduleValue: "08:00,20:00", timezone: "Asia/Shanghai", jitterMinutes: 0 },
      from
    );
    expect(next!.toISOString()).toBe("2025-06-15T00:00:00.000Z");
  });

  it("已过今天所有时间 → 返回明天第一个时间点", () => {
    // from = 2025-06-15 13:00 UTC = 2025-06-15 21:00 CST (已过 20:00)
    const from = new Date("2025-06-15T13:00:00Z");
    const next = computeNextRun(
      { scheduleType: "daily", scheduleValue: "08:00,20:00", timezone: "Asia/Shanghai", jitterMinutes: 0 },
      from
    );
    expect(next!.toISOString()).toBe("2025-06-16T00:00:00.000Z");
  });
});

describe("computeNextRun - interval", () => {
  it("每隔 60 分钟", () => {
    const from = new Date("2025-06-15T10:00:00Z");
    const next = computeNextRun(
      { scheduleType: "interval", scheduleValue: "60", timezone: "Asia/Shanghai", jitterMinutes: 0 },
      from
    );
    expect(next!.toISOString()).toBe("2025-06-15T11:00:00.000Z");
  });

  it("非法输入返回 null", () => {
    expect(computeNextRun(
      { scheduleType: "interval", scheduleValue: "abc", timezone: "UTC", jitterMinutes: 0 },
      new Date()
    )).toBeNull();
  });

  it("非法 daily 格式返回 null", () => {
    expect(computeNextRun(
      { scheduleType: "daily", scheduleValue: "8am", timezone: "UTC", jitterMinutes: 0 },
      new Date()
    )).toBeNull();
  });
});
