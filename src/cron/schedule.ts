/**
 * 根据 scheduleType/scheduleValue/timezone/jitterMinutes 计算下一次执行时间。
 * 严格按 PLAN.md 附录 A 算法实现。
 */

interface ScheduleInput {
  scheduleType: "daily" | "interval";
  scheduleValue: string;
  timezone: string;
  jitterMinutes: number;
}

/**
 * 将本地墙钟时间转为 UTC Date。
 * 算法：先用 ISO 拼出无时差猜测 → 用 Intl 格式化得到"假装 UTC"的时间 → 算偏移 → 修正。
 * 两轮迭代以处理 DST 边界。
 */
export function localWallToUtc(dateStr: string, hm: string, tz: string): Date {
  const guess = new Date(`${dateStr}T${hm}:00Z`).getTime();

  // 第一轮：计算偏移
  const offset1 = getOffset(guess, tz);
  const utc1 = guess - offset1;

  // 第二轮：用 utc1 重新算偏移（处理 DST 边界）
  const offset2 = getOffset(utc1, tz);
  const utc2 = guess - offset2;

  return new Date(utc2);
}

function getOffset(utcMs: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const iso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`;
  return Date.parse(iso) - utcMs;
}

/**
 * 获取某个 UTC 时刻在指定时区下的本地日期字符串 YYYY-MM-DD
 */
function localDateStr(utcMs: number, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(utcMs));
}

export function computeNextRun(input: ScheduleInput, fromDate: Date): Date | null {
  const { scheduleType, scheduleValue, timezone, jitterMinutes } = input;

  try {
    if (scheduleType === "daily") {
      const times = scheduleValue.split(",").map((s) => s.trim()).sort();
      if (times.length === 0 || !times.every((t) => /^\d{2}:\d{2}$/.test(t))) return null;

      const from = fromDate.getTime();
      for (let dayOffset = 0; dayOffset <= 400; dayOffset++) {
        const dayMs = from + dayOffset * 86400000;
        const ld = localDateStr(dayMs, timezone);
        for (const hm of times) {
          const utc = localWallToUtc(ld, hm, timezone).getTime();
          if (utc > from) {
            return addJitter(new Date(utc), jitterMinutes);
          }
        }
      }
      return null;
    }

    if (scheduleType === "interval") {
      const minutes = parseInt(scheduleValue, 10);
      if (isNaN(minutes) || minutes < 1) return null;
      const next = fromDate.getTime() + minutes * 60000;
      return addJitter(new Date(next), jitterMinutes);
    }

    return null;
  } catch {
    return null;
  }
}

function addJitter(date: Date, maxMinutes: number): Date {
  if (maxMinutes <= 0) return date;
  const jitter = Math.floor(Math.random() * (maxMinutes + 1)) * 60000;
  return new Date(date.getTime() + jitter);
}
