import { HttpError } from './http.mjs';
export function activityWindow(range, timestamp) {
  if (!["7d", "30d", "quarter", "year"].includes(range)) throw new HttpError(400, "Choose 7d, 30d, quarter, or year.");
  const end = new Date(timestamp);
  end.setUTCHours(0, 0, 0, 0);
  let start;
  if (range === "7d" || range === "30d") start = new Date(end.getTime() - (range === "7d" ? 6 : 29) * 86400000);
  else {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (range === "quarter" ? 3 : 12), 1));
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(end.getUTCDate(), lastDay));
    // Include today and exclude the same date three/twelve calendar months ago.
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return { startDay: start.toISOString().slice(0, 10), endDay: end.toISOString().slice(0, 10) };
}
