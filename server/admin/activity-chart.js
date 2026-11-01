export function renderActivityChart(series, startDay, endDay, {prefix='',links=series,label=link=>'/r/'+link.slug,metric='click',entity='active links'}={}) {
  const $=id=>document.getElementById(prefix+id);
  const number=new Intl.NumberFormat();
  const element=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const svg = $("activity-chart");
  svg.replaceChildren();
  const tooltip = $("chart-tooltip");
  tooltip.hidden = true;
  svg.onpointermove = svg.onpointerdown = svg.onpointerleave = svg.onfocus = svg.onblur = svg.onkeydown = null;
  $("chart-legend").replaceChildren();
  $("chart-scale").replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  function shape(tag, attributes) {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
    return node;
  }
  const palette = ["#ff646b", "#68c9ef", "#b59aff", "#b8dc74", "#ffca70", "#ed8dce", "#7ed8c5", "#fa9c78"];
  const colors = new Map([...links].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((link, index) => [link.id, palette[index] ?? `hsl(${(index * 137.508 % 360).toFixed(3)} 78% 70%)`]));
  // Keep colors stable, but only plot items with activity in this date range.
  series = series.filter(item => item.daily.some(day => day.day >= startDay && day.day <= endDay && day.clicks > 0));
  svg.parentElement.hidden = !series.length;
  svg.closest('.activity').classList.toggle('is-empty', !series.length);
  let peak = 0;
  let total = 0;
  for (const link of series) for (const day of link.daily) { peak = Math.max(peak, day.clicks); total += day.clicks; }
  const step = Math.max(1, Math.ceil(peak / 4));
  const max = step * 4;
  for (let index = 0; index <= 4; index++) {
    const y = 12 + index * 44;
    shape("line", { x1: 8, x2: 892, y1: y, y2: y, class: "chart-grid" });
    $("chart-scale").append(element("span", "", number.format(max - step * index)));
  }
  const end = Date.parse(`${endDay}T00:00:00Z`);
  const start = Date.parse(`${startDay}T00:00:00Z`);
  const dayCount = Math.round((end - start) / 86400000) + 1;
  const lastIndex = dayCount - 1;
  const xStep = 884 / lastIndex;
  const days = Array.from({ length: dayCount }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
  const plotted = [];
  $("chart-start").textContent = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", ...(new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear() ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(start));
  for (const link of series) {
    const color = colors.get(link.id);
    const counts = new Map(link.daily.map(day => [day.day, day.clicks]));
    const points = days.map((day, index) => ({ day, value: counts.get(day) ?? 0, x: 8 + index * xStep, y: 188 - (counts.get(day) ?? 0) / max * 176 }));
    const line = shape("path", { d: points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "), stroke: color, class: "chart-line", "vector-effect": "non-scaling-stroke" });
    plotted.push({ link, color, points, line });
    for (const point of points.filter(point => point.value > 0)) {
      shape("ellipse", { cx: point.x, cy: point.y, rx: 3, ry: 3, fill: color, class: "chart-point" });
    }
  }
  const clickLabel = `${number.format(total)} ${total === 1 ? metric : metric+"s"}`;
  svg.setAttribute("aria-label", `Daily ${metric}s for ${series.length} ${entity} from ${startDay} to ${endDay}. ${clickLabel} total.`);
  $("chart-message").textContent = !series.length ? `No ${metric}s in this period.` : `${clickLabel} across ${entity}`;
  if (!plotted.length) return;

  const guide = shape("line", { x1: 8, x2: 8, y1: 12, y2: 188, class: "chart-guide", visibility: "hidden" });
  const highlights = [];
  let keyboardIndex = lastIndex;
  let visibleKey = "";
  function hideTooltip() {
    visibleKey = "";
    tooltip.hidden = true;
    guide.setAttribute("visibility", "hidden");
    for (const marker of highlights.splice(0)) marker.remove();
    for (const item of plotted) item.line.classList.remove("is-highlighted", "is-muted");
  }
  function showTooltip(items, index) {
    const key = `${index}:${svg.clientWidth}:${svg.clientHeight}:${items.map(item => item.link.id).join(",")}`;
    if (!tooltip.hidden && key === visibleKey) return;
    hideTooltip();
    visibleKey = key;
    keyboardIndex = index;
    const point = items[0].points[index];
    $("chart-tooltip-date").textContent = `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${point.day}T00:00:00Z`))} · UTC`;
    $("chart-tooltip-links").replaceChildren();
    const active = items.filter(item => item.points[index].value > 0).sort((a,b) => b.points[index].value-a.points[index].value);
    if (!active.length) $("chart-tooltip-links").append(element("p", "chart-tooltip-empty", `No ${metric}s on this day.`));
    for (const item of active) {
      const sample = item.points[index];
      const row = element("div", "chart-tooltip-row");
      const swatch = document.createElementNS(ns, "svg");
      swatch.setAttribute("viewBox", "0 0 10 10");
      swatch.setAttribute("aria-hidden", "true");
      const dot = document.createElementNS(ns, "circle");
      for (const [name, value] of Object.entries({ cx: 5, cy: 5, r: 4, fill: item.color })) dot.setAttribute(name, value);
      swatch.append(dot);
      const identity = element("div", "chart-tooltip-identity");
      const title = element("strong", "", label(item.link));
      title.title = label(item.link);
      identity.append(title);
      row.append(swatch, identity, element("span", "chart-tooltip-count", `${number.format(sample.value)} ${sample.value === 1 ? metric : metric+"s"}`));
      $("chart-tooltip-links").append(row);
      highlights.push(shape("ellipse", { cx: sample.x, cy: sample.y, rx: 5, ry: 5, fill: item.color, class: "chart-hover-point" }));
    }
    for (const item of plotted) item.line.classList.add(active.includes(item) ? "is-highlighted" : "is-muted");
    guide.setAttribute("x1", point.x);
    guide.setAttribute("x2", point.x);
    guide.setAttribute("visibility", "visible");
    tooltip.hidden = false;
    const plot = svg.getBoundingClientRect();
    const wrap = svg.parentElement.getBoundingClientRect();
    const x = plot.left - wrap.left + point.x / 900 * plot.width;
    const y = plot.top - wrap.top + point.y / 200 * plot.height;
    // CSSOM properties keep positioning compatible with the admin's strict CSP.
    tooltip.style.left = `${Math.max(12, Math.min(wrap.width - tooltip.offsetWidth - 12, x + 16))}px`;
    const above = y - tooltip.offsetHeight - 16;
    tooltip.style.top = `${Math.max(0, Math.min(wrap.height - tooltip.offsetHeight, above >= 0 ? above : y + 16))}px`;
  }
  svg.onpointermove = svg.onpointerdown = event => {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const scaleX = rect.width / 900;
    const index = Math.max(0, Math.min(lastIndex, Math.round((x / scaleX - 8) / xStep)));
    // The whole plot is a touch target; a precise hit on a thin line isn't needed.
    showTooltip(plotted, index);
  };
  svg.onpointerleave = svg.onblur = hideTooltip;
  svg.onfocus = () => { if (tooltip.hidden) showTooltip(plotted, keyboardIndex); };
  svg.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); return hideTooltip(); }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? lastIndex : Math.max(0, Math.min(lastIndex, keyboardIndex + (event.key === "ArrowLeft" ? -1 : 1)));
    showTooltip(plotted, index);
  };
}
