/**
 * The emotional wellbeing trend (C4.3).
 *
 * Four small series, per week: mood check-ins, how the after-chat
 * answers went, how many days the user came, and how often they came
 * between midnight and five. The numbers are theirs, and the page states
 * them; it does not score them.
 *
 * The answer carries the weeks and the two four-week halves. The
 * comparison is a sentence, not a percentage, and it is computed here so
 * the page cannot compare different windows.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDailyChatCounts,
  getUserMoods,
  listCheckinAnswersSince,
  listUserMessageTimesSince,
} from "../db";
import { zonedDateKey, zonedDayStart } from "@shared/timezone";

interface Week {
  /** The Monday of the week, as a date key in the user's calendar. */
  start: string;
  end: string;
  moods: number;
  checkins: { better: number; same: number; worse: number };
  visits: number;
  lateNight: number;
  messages: number;
}

/** The Monday of the week a day key belongs to, as a date key. */
function weekStartOf(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // 0 is Sunday; the week starts on Monday.
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export const wellbeingRouter = router({
  get: protectedProcedure
    .query(async ({ ctx }) => {
      const timezone = ctx.user.timezone;
      const now = new Date();
      // Eight weeks back from the start of this week.
      const firstWeek = (() => {
        const start = weekStartOf(zonedDateKey(now, timezone));
        const date = new Date(`${start}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() - 49);
        return date.toISOString().slice(0, 10);
      })();
      const since = zonedDayStart(new Date(`${firstWeek}T12:00:00.000Z`), timezone);

      const [moods, checkins, messageTimes, daily] = await Promise.all([
        getUserMoods(ctx.user.id, 63, timezone),
        listCheckinAnswersSince(ctx.user.id, since),
        listUserMessageTimesSince(ctx.user.id, since),
        getDailyChatCounts(ctx.user.id, 63, timezone),
      ]);

      const weeks: Week[] = [];
      for (let index = 0; index < 8; index++) {
        const start = new Date(`${firstWeek}T00:00:00.000Z`);
        start.setUTCDate(start.getUTCDate() + index * 7);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 6);
        weeks.push({
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
          moods: 0,
          checkins: { better: 0, same: 0, worse: 0 },
          visits: 0,
          lateNight: 0,
          messages: 0,
        });
      }

      const indexOf = new Map(weeks.map((week, index) => [week.start, index]));
      const weekOfDay = (dayKey: string) => indexOf.get(weekStartOf(dayKey));

      for (const mood of moods) {
        const index = weekOfDay(mood.date);
        if (index !== undefined) weeks[index].moods += 1;
      }
      for (const row of checkins) {
        const day = zonedDateKey(row.createdAt, timezone);
        const index = weekOfDay(day);
        if (index === undefined) continue;
        const answer = row.answer as "better" | "same" | "worse" | "skipped";
        if (answer === "better") weeks[index].checkins.better += 1;
        else if (answer === "same") weeks[index].checkins.same += 1;
        else if (answer === "worse") weeks[index].checkins.worse += 1;
      }
      for (const row of daily) {
        const index = weekOfDay(row.date);
        if (index !== undefined && Number(row.userCount) > 0) weeks[index].visits += 1;
      }
      for (const row of messageTimes) {
        const day = zonedDateKey(row.at, timezone);
        const index = weekOfDay(day);
        if (index === undefined) continue;
        weeks[index].messages += 1;
        const hour = Number(
          new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            hour12: false,
            timeZone: timezone || undefined,
          }).format(row.at),
        );
        if (hour >= 0 && hour < 5) weeks[index].lateNight += 1;
      }

      const sum = (slice: Week[]) => ({
        moods: slice.reduce((total, week) => total + week.moods, 0),
        checkins: slice.reduce(
          (total, week) => ({
            better: total.better + week.checkins.better,
            same: total.same + week.checkins.same,
            worse: total.worse + week.checkins.worse,
          }),
          { better: 0, same: 0, worse: 0 },
        ),
        visits: slice.reduce((total, week) => total + week.visits, 0),
        lateNight: slice.reduce((total, week) => total + week.lateNight, 0),
      });

      return {
        weeks,
        recent: sum(weeks.slice(4)),
        previous: sum(weeks.slice(0, 4)),
      };
    }),
});

export default wellbeingRouter;
