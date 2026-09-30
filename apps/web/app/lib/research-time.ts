export function researchTime(value: string | null, precision = "minute", raw?: string): string {
  if (!value) return raw || "未知";
  if (precision === "day" || precision === "unknown") return `${raw || value.slice(0, 10)}${precision === "unknown" ? "（精度未核实）" : ""}`;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium", timeStyle: precision === "second" ? "medium" : "short", timeZone: "Pacific/Auckland",
  }).format(new Date(value));
}
