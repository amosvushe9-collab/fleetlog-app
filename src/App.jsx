import { useState, useEffect, useMemo } from "react";
import { supabase } from './supabase.js'

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return crypto.randomUUID(); }
function fmt(n) { return "$" + Number(n || 0).toFixed(2); }
function fmtKm(n) { return Number(n || 0).toFixed(0) + " km"; }
function fmtRate(n) { return "$" + Number(n || 0).toFixed(3) + "/km"; }
function today() { return new Date().toISOString().slice(0, 10); }
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMondayStr(ref) {
  const d = ref ? new Date(ref) : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function getSundayStr(mondayStr) {
  const d = new Date(mondayStr);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtWeekRange(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr || addDaysStr(startStr, 6));
  const opts = { day: "numeric", month: "short" };
  return start.toLocaleDateString("en-GB", opts) + " \u2013 " + end.toLocaleDateString("en-GB", { ...opts, year: "numeric" });
}
function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date(today())) / 86400000);
}
function fmtDaysExtra(d) {
  const absD = Math.abs(d);
  if (absD < 14) return "";
  const weeks = Math.round(absD / 7);
  const months = absD / 30.44;
  if (absD < 60) return " (~" + weeks + "wk)";
  return " (~" + months.toFixed(1) + "mo)";
}
function docStatus(expiry) {
  const d = daysUntil(expiry);
  if (d < 0)   return { label: "Expired " + Math.abs(d) + "d ago" + fmtDaysExtra(d), color: "#ef4444", level: "expired" };
  if (d <= 7)  return { label: "Expires in " + d + "d \u2014 urgent!", color: "#ef4444", level: "critical" };
  if (d <= 30) return { label: "Expires in " + d + "d" + fmtDaysExtra(d), color: "#f59e0b", level: "soon" };
  return { label: "Valid \u00b7 " + d + "d left" + fmtDaysExtra(d), color: "#22c55e", level: "ok" };
}
function currentOdometer(car, weeks) {
  const baseline = Number(car.odometer_baseline || 0);
  const baselineDate = car.odometer_baseline_date;
  const carWeeks = weeks.filter(w => w.car_id === car.id);
  const countedKm = carWeeks
    .filter(w => !baselineDate || w.week_start >= baselineDate)
    .reduce((s, w) => s + Number(w.km || 0), 0);
  return baseline + countedKm;
}
function monthKey(dateStr) { return dateStr ? dateStr.slice(0, 7) : ""; }
function monthLabel(key) {
  if (key === "all") return "All Time";
  const parts = key.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// ── Sector Configuration ──────────────────────────────────────────────────────
const SECTORS = {
  ridehailing: {
    label: "Ride-Hailing",
    icon: "🚗",
    desc: "InDrive, Uber, Bolt — driver pays you weekly",
    vehicleLabel: "Car",
    vehiclesLabel: "Cars",
    incomeLabel: "Weekly Income",
    incomeTab: "Weekly",
    driverLabel: "Driver",
    extraDocTypes: [],
    extraAlerts: [],
    incomeFields: ["weekStart", "weekEnd", "km", "amount", "paid"],
    color: "#22d3ee",
  },
  kombi: {
    label: "Kombi / Minibus",
    icon: "🚌",
    desc: "Minibus taxis — daily takings from driver",
    vehicleLabel: "Kombi",
    vehiclesLabel: "Kombis",
    incomeLabel: "Daily Takings",
    incomeTab: "Daily",
    driverLabel: "Driver",
    extraDocTypes: ["Route Permit", "Operator Licence", "PSV Licence"],
    extraAlerts: [{ label: "Brake Pads", intervalKm: 30000, lastDoneKm: 0 }],
    incomeFields: ["date", "route", "amount", "paid"],
    color: "#f59e0b",
  },
  haulage: {
    label: "Haulage / Trucks",
    icon: "🚛",
    desc: "Trucks — income per trip or load",
    vehicleLabel: "Truck",
    vehiclesLabel: "Trucks",
    incomeLabel: "Trip Income",
    incomeTab: "Trips",
    driverLabel: "Driver",
    extraDocTypes: ["Certificate of Fitness (COF)", "Goods Vehicle Licence", "Cross-Border Permit"],
    extraAlerts: [{ label: "Wheel Alignment", intervalKm: 20000, lastDoneKm: 0 }, { label: "Trailer Service", intervalKm: 15000, lastDoneKm: 0 }],
    incomeFields: ["date", "origin", "destination", "loadType", "amount", "paid"],
    color: "#ef4444",
  },
  schoolbus: {
    label: "School Bus",
    icon: "🏫",
    desc: "School transport — monthly contracts",
    vehicleLabel: "Bus",
    vehiclesLabel: "Buses",
    incomeLabel: "Contract Income",
    incomeTab: "Contracts",
    driverLabel: "Driver",
    extraDocTypes: ["PSV Licence", "School Transport Permit", "Operator Licence"],
    extraAlerts: [],
    incomeFields: ["month", "school", "learners", "amount", "paid"],
    color: "#22c55e",
  },
};

function getSectorCfg(sector) {
  return SECTORS[sector] || SECTORS.ridehailing;
}

const DOC_TYPES = ["Insurance (Full Cover)", "Insurance (Third Party)", "ZINARA / Vehicle Licence", "Roadworthy Certificate", "Other"];
const COST_CATS = ["Service & Insurance", "Tyres", "Repairs", "Accessories", "Safety", "Electronics", "Other"];
const INCIDENT_STATUSES = ["Quoted", "Approved", "In Repair", "Done"];

function DEFAULT_ALERTS() {
  return [
    { id: uid(), label: "Oil & Filter", intervalKm: 5000, lastDoneKm: 0 },
    { id: uid(), label: "Tyre Rotation", intervalKm: 10000, lastDoneKm: 0 },
    { id: uid(), label: "Full Service", intervalKm: 20000, lastDoneKm: 0 },
  ];
}

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#080c14", surface: "#0f1623", border: "#1a2236",
  text: "#e2e8f0", muted: "#64748b", faint: "#1e293b",
  green: "#22c55e", cyan: "#22d3ee", amber: "#f59e0b",
  red: "#ef4444", purple: "#a855f7",
};

function mkS() {
  return {
    app: { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter','Segoe UI',sans-serif", fontSize: 14 },
    header: { background: C.surface, borderBottom: "1px solid " + C.border, padding: "0 16px", display: "flex", alignItems: "center", gap: 10, height: 52, position: "sticky", top: 0, zIndex: 100 },
    logo: { color: C.cyan, fontWeight: 800, fontSize: 17, letterSpacing: "-0.04em" },
    page: { padding: "16px", maxWidth: 960, margin: "0 auto" },
    card: { background: C.surface, border: "1px solid " + C.border, borderRadius: 12, padding: 16 },
    row: { display: "flex", gap: 10, flexWrap: "wrap" },
    label: { color: C.muted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5, display: "block" },
    input: { background: C.faint, border: "1px solid " + C.border, borderRadius: 8, color: C.text, padding: "9px 12px", fontSize: 14, width: "100%", boxSizing: "border-box", outline: "none" },
    btn: (bg) => { const b = bg || C.cyan; return { background: b, color: b === C.cyan || b === C.green ? "#000" : "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }; },
    ghost: { background: "transparent", color: C.muted, border: "1px solid " + C.border, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
    th: { color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: "1px solid " + C.border, whiteSpace: "nowrap" },
    td: { padding: "9px 10px", borderBottom: "1px solid " + C.faint, verticalAlign: "middle" },
    title: { fontSize: 18, fontWeight: 700, color: "#f8fafc", marginBottom: 4 },
    sub: { color: C.muted, fontSize: 13, marginBottom: 20 },
  };
}
const S = mkS();

function Stat({ label, value, sub, color, small }) {
  const statColor = color || C.cyan;
  return (
    <div style={{ background: C.faint, borderRadius: 10, padding: small ? "10px 14px" : "14px 18px", flex: 1, minWidth: 100 }}>
      <div style={{ color: C.muted, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{label}</div>
      <div style={{ color: statColor, fontWeight: 700, fontSize: small ? 15 : 20, fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AlertBar({ alert, kmTotal }) {
  const kmSince = kmTotal - alert.lastDoneKm;
  const remaining = alert.intervalKm - kmSince;
  const pct = Math.min(kmSince / alert.intervalKm, 1);
  const status = remaining <= 0 ? "due" : remaining <= alert.intervalKm * 0.15 ? "soon" : "ok";
  const color = status === "due" ? C.red : status === "soon" ? C.amber : C.green;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: status !== "ok" ? color : C.text, fontWeight: status !== "ok" ? 700 : 400 }}>
          {status === "due" && "⚠ "}{status === "soon" && "⏳ "}{alert.label}
        </span>
        <span style={{ fontSize: 11, color: C.muted }}>
          {status === "due" ? `Overdue ${fmtKm(Math.abs(remaining))}` : `${fmtKm(remaining)} left`}
        </span>
      </div>
      <div style={{ height: 5, background: C.border, borderRadius: 99 }}>
        <div style={{ height: 5, borderRadius: 99, width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function WeeklyBars({ weeks, cars }) {
  const sorted = [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start)).slice(-12);
  if (!sorted.length) return null;
  const maxKm = Math.max(...sorted.map(w => w.km), 1);
  const byWeek = {};
  sorted.forEach(w => {
    if (!byWeek[w.week_start]) byWeek[w.week_start] = {};
    byWeek[w.week_start][w.car_id] = w.km;
  });
  const weekKeys = [...new Set(sorted.map(w => w.week_start))];
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, minWidth: weekKeys.length * 56 }}>
        {weekKeys.map(wk => (
          <div key={wk} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 100 }}>
              {cars.map(car => {
                const km = byWeek[wk]?.[car.id] || 0;
                const h = Math.round((km / maxKm) * 90);
                return <div key={car.id} title={`${car.name}: ${fmtKm(km)}`} style={{ width: 14, height: Math.max(h, 2), background: car.color, borderRadius: "3px 3px 0 0", opacity: km ? 1 : 0.15 }} />;
              })}
            </div>
            <div style={{ fontSize: 9, color: C.muted, textAlign: "center" }}>
              {new Date(wk).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
        {cars.map(c => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c.color }} />
            {c.name}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TOP-LEVEL FORM COMPONENTS
// Defined outside App so React keeps stable identity across renders —
// this is what keeps inputs focused while typing (the keyboard-closing fix).
// ════════════════════════════════════════════════════════════════════════════

function WeekForm({ wForm, setWForm, cars, editingWeekId, activeDay, setActiveDay, syncing, onSave, onCancel }) {
  const totalKm = wForm.entryMode === "total"
    ? Number(wForm.totalKm) || 0
    : wForm.days.reduce((s, d) => s + (Number(d) || 0), 0);
  const perKm = totalKm > 0 && wForm.amount > 0 ? Number(wForm.amount) / totalKm : 0;
  const [csvInfo, setCsvInfo] = useState(null);
  const [csvError, setCsvError] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvDateWarning, setCsvDateWarning] = useState("");

  const spanDays = Math.max(1, Math.round((new Date(wForm.weekEnd) - new Date(wForm.weekStart)) / 86400000) + 1);
  const isStandardWeek = spanDays === 7;

  function dayDate(i) {
    const d = new Date(wForm.weekStart);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function handleCsvUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setCsvError("");
    setCsvLoading(true);
    setCsvInfo(null);

    const reader = new FileReader();
    reader.onerror = () => {
      setCsvLoading(false);
      setCsvError("Couldn't open that file. Try selecting it again.");
    };
    reader.onload = (evt) => {
      setCsvLoading(false);
      try {
        let text = evt.target.result;
        if (typeof text !== "string") throw new Error("Empty file");
        text = text.replace(/^\uFEFF/, "");
        const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) throw new Error("File only has a header row, no data");

        const parseLine = (line) => line.split(",").map(cell => cell.replace(/^\t+/, "").trim());
        const headers = parseLine(lines[0]);
        const values = parseLine(lines[1]);
        const row = {};
        headers.forEach((h, i) => { row[h] = values[i]; });

        const kmKey = Object.keys(row).find(k => /mileage/i.test(k));
        const startKey = Object.keys(row).find(k => /start/i.test(k));
        const endKey = Object.keys(row).find(k => /end/i.test(k));
        const nameKey = Object.keys(row).find(k => /device/i.test(k));

        const km = kmKey ? parseFloat(row[kmKey]) : NaN;
        if (isNaN(km)) throw new Error("Found the file but couldn't read a mileage number from it");

        const deviceName = nameKey ? row[nameKey] : "Vehicle";

        // Declare matchedCar FIRST before any reference to it
        const matchedCar = cars.find(c =>
          deviceName.toLowerCase().includes(c.name.toLowerCase()) ||
          c.name.toLowerCase().includes(deviceName.toLowerCase())
        );

        const rawStart = startKey ? row[startKey] : "";
        const rawEnd = endKey ? row[endKey] : "";
        const startDateOnly = rawStart ? rawStart.split(" ")[0] : "";
        const endDateOnly = rawEnd ? rawEnd.split(" ")[0] : "";

        let dateWarning = "";
        if (startDateOnly && endDateOnly) {
          const sd = new Date(startDateOnly);
          const ed = new Date(endDateOnly);
          const dayDiff = Math.round((ed - sd) / 86400000);
          const startDow = sd.getDay();
          if (startDow !== 1) {
            dateWarning = "This range starts on a " + sd.toLocaleDateString("en-GB", { weekday: "long" }) + ", not a Monday — that's fine, it's been captured exactly as shown below.";
          } else if (dayDiff !== 6) {
            dateWarning = "This range covers " + (dayDiff + 1) + " days, not a full 7-day week — that's fine, it's been captured exactly as shown below.";
          }
        }
        setCsvDateWarning(dateWarning);

        setCsvInfo({
          km,
          startDate: startKey ? row[startKey] : "",
          endDate: endKey ? row[endKey] : "",
          deviceName,
          carMatched: matchedCar ? matchedCar.name : null,
        });

        // CSV gives one total for the range — always goes into total-only mode with real start/end dates
        setWForm(f => ({
          ...f,
          entryMode: "total",
          weekStart: startDateOnly && !isNaN(new Date(startDateOnly)) ? startDateOnly : f.weekStart,
          weekEnd: endDateOnly && !isNaN(new Date(endDateOnly)) ? endDateOnly : f.weekEnd,
          totalKm: String(km),
          days: Array(7).fill(""),
          // Only auto-switch car if we found a confident match
          ...(matchedCar ? { carId: matchedCar.id } : {}),
        }));
      } catch (err) {
        setCsvError(err.message || "Couldn't read that file — make sure it's the SinoTrack mileage export CSV");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div style={{ ...S.card, maxWidth: 560, marginBottom: 20, borderColor: C.cyan + "55" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: C.cyan, fontSize: 15 }}>{editingWeekId ? "Edit Week" : "Log This Week"}</div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>{fmtWeekRange(wForm.weekStart, wForm.weekEnd)} · {spanDays} day{spanDays !== 1 ? "s" : ""}</div>
      </div>

      <div style={{ background: C.faint, borderRadius: 8, padding: "12px 14px", marginBottom: 16, border: `1px dashed ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: csvInfo ? 10 : 0 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Import from SinoTrack</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Pick any date range on SinoTrack, download CSV, upload here</div>
          </div>
          <label style={{ ...S.btn(C.cyan), padding: "7px 14px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            {csvLoading ? "Reading..." : "Choose File"}
            <input type="file" accept=".csv,text/csv,text/plain,application/vnd.ms-excel" onChange={handleCsvUpload} style={{ display: "none" }} />
          </label>
        </div>
        {csvLoading && <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Reading file...</div>}
        {csvError && <div style={{ color: C.red, fontSize: 11, marginTop: 8 }}>{csvError}</div>}
        {csvInfo && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, color: C.cyan, fontWeight: 700, marginBottom: 4 }}>
              ✓ {csvInfo.deviceName} — {csvInfo.km.toFixed(1)} km imported
            </div>
            <div style={{ fontSize: 10, color: C.muted }}>
              {csvInfo.startDate} → {csvInfo.endDate} · dates set automatically below
            </div>
            {csvInfo.carMatched && (
              <div style={{ fontSize: 10, color: C.green, marginTop: 4 }}>
                ✓ Car auto-selected: {csvInfo.carMatched}
              </div>
            )}
            {!csvInfo.carMatched && (
              <div style={{ fontSize: 10, color: C.amber, marginTop: 4 }}>
                ⚠ Couldn't match device name to a car — please select the car manually below.
              </div>
            )}
            {csvDateWarning && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                ℹ {csvDateWarning}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ ...S.row, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Car</label>
          <select style={S.input} value={wForm.carId} onChange={e => setWForm(f => ({ ...f, carId: e.target.value }))}>
            {cars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Start Date</label>
          <input
            type="date" style={S.input} value={wForm.weekStart}
            onChange={e => {
              const newStart = e.target.value;
              setWForm(f => {
                // If the gap to the current end no longer makes sense, suggest +6 days — but never force it
                const currentSpan = Math.round((new Date(f.weekEnd) - new Date(f.weekStart)) / 86400000);
                const newEnd = new Date(newStart) > new Date(f.weekEnd) ? addDaysStr(newStart, Math.max(currentSpan, 0)) : f.weekEnd;
                return { ...f, weekStart: newStart, weekEnd: newEnd };
              });
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>End Date</label>
          <input
            type="date" style={S.input} value={wForm.weekEnd}
            onChange={e => setWForm(f => ({ ...f, weekEnd: e.target.value }))}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          style={{ ...S.btn(wForm.entryMode === "daily" ? C.cyan : C.faint), flex: 1, color: wForm.entryMode === "daily" ? "#000" : C.muted, fontSize: 12 }}
          onClick={() => setWForm(f => ({ ...f, entryMode: "daily" }))}
        >
          Daily breakdown
        </button>
        <button
          style={{ ...S.btn(wForm.entryMode === "total" ? C.cyan : C.faint), flex: 1, color: wForm.entryMode === "total" ? "#000" : C.muted, fontSize: 12 }}
          onClick={() => setWForm(f => ({ ...f, entryMode: "total" }))}
        >
          Just enter total km
        </button>
      </div>

      {wForm.entryMode === "daily" ? (
        <>
          {!isStandardWeek && (
            <div style={{ fontSize: 11, color: C.amber, marginBottom: 8 }}>
              ℹ This range is {spanDays} days, not 7 — the daily grid below assumes a 7-day week starting on
              the Start Date. If that doesn't fit, switch to "Just enter total km" above instead.
            </div>
          )}
          <label style={S.label}>Daily Mileage — tap each day as you read SinoTrack</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 12 }}>
            {DAYS.map((day, i) => {
              const isActive = activeDay === i;
              const hasVal = Number(wForm.days[i]) > 0;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: isActive ? C.cyan : C.muted, textTransform: "uppercase" }}>{day}</div>
                  <div style={{ fontSize: 9, color: C.muted }}>{dayDate(i)}</div>
                  <input
                    type="number" inputMode="numeric" placeholder="0"
                    value={wForm.days[i]}
                    onFocus={() => setActiveDay(i)}
                    onBlur={() => setActiveDay(null)}
                    onChange={e => { const days = [...wForm.days]; days[i] = e.target.value; setWForm(f => ({ ...f, days })); }}
                    style={{ ...S.input, textAlign: "center", padding: "10px 2px", fontSize: 15, fontWeight: 700, fontFamily: "monospace", borderColor: isActive ? C.cyan : C.border, color: hasVal ? C.cyan : C.muted, background: isActive ? "#0d2030" : C.faint, width: "100%" }}
                  />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Total Mileage for This Range (km)</label>
          <input
            type="number" inputMode="numeric" placeholder="e.g. 602"
            value={wForm.totalKm}
            onChange={e => setWForm(f => ({ ...f, totalKm: e.target.value }))}
            style={{ ...S.input, fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: C.cyan, padding: "12px 14px" }}
          />
        </div>
      )}

      <div style={{ background: C.faint, borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ color: C.muted, fontSize: 12 }}>Total</span>
          <span style={{ color: C.cyan, fontWeight: 800, fontFamily: "monospace", fontSize: 18 }}>{totalKm.toFixed(0)} km</span>
        </div>
        {perKm > 0 && <span style={{ color: C.amber, fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>{fmtRate(perKm)}</span>}
      </div>

      <div style={{ ...S.row, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Payment Received ($)</label>
          <input type="number" inputMode="numeric" style={{ ...S.input, fontSize: 16, fontWeight: 700 }}
            placeholder={cars.find(c => c.id === wForm.carId)?.weekly_rate || 130}
            value={wForm.amount} onChange={e => setWForm(f => ({ ...f, amount: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Status</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...S.btn(wForm.paid ? C.green : C.faint), flex: 1, color: wForm.paid ? "#000" : C.muted }} onClick={() => setWForm(f => ({ ...f, paid: true }))}>✓ Paid</button>
            <button style={{ ...S.btn(!wForm.paid ? C.amber : C.faint), flex: 1, color: !wForm.paid ? "#000" : C.muted }} onClick={() => setWForm(f => ({ ...f, paid: false }))}>Pending</button>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Notes (optional)</label>
        <input style={S.input} placeholder="e.g. Gweru trip, short week..." value={wForm.notes} onChange={e => setWForm(f => ({ ...f, notes: e.target.value }))} />
      </div>

      <div style={S.row}>
        <button style={{ ...S.btn(), flex: 1 }} onClick={onSave} disabled={syncing}>{syncing ? "Saving..." : editingWeekId ? "Update Week" : "Save Week"}</button>
        <button style={S.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function CostForm({ cForm, setCForm, cars, editingCostId, syncing, onSave, onCancel }) {
  return (
    <div style={{ ...S.card, maxWidth: 500, marginBottom: 16, borderColor: C.red + "44" }}>
      <div style={{ fontWeight: 700, color: C.red, marginBottom: 14 }}>{editingCostId ? "Edit Cost" : "Record Cost"}</div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Car</label>
          <select style={S.input} value={cForm.carId} onChange={e => setCForm(f => ({ ...f, carId: e.target.value }))}>
            {cars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>Date</label>
          <input type="date" style={S.input} value={cForm.date} onChange={e => setCForm(f => ({ ...f, date: e.target.value }))} />
        </div>
      </div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Amount ($)</label>
          <input type="number" style={S.input} value={cForm.amount} onChange={e => setCForm(f => ({ ...f, amount: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>Category</label>
          <select style={S.input} value={cForm.category} onChange={e => setCForm(f => ({ ...f, category: e.target.value }))}>
            {COST_CATS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}><label style={S.label}>Description</label>
        <input style={S.input} placeholder="e.g. 3 tyres, insurance..." value={cForm.notes} onChange={e => setCForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
      <div style={S.row}>
        <button style={S.btn(C.red)} onClick={onSave} disabled={syncing}>{syncing ? "Saving..." : editingCostId ? "Update" : "Save"}</button>
        <button style={S.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DocForm({ form, setForm, cars, syncing, uploading, onSave, onCancel }) {
  const fileInputId = `doc-photo-${form.carId}`;
  function handlePhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setForm(f => ({ ...f, photoFile: file, photoPreview: URL.createObjectURL(file) }));
  }
  return (
    <div style={{ ...S.card, maxWidth: 500, marginBottom: 16, borderColor: C.cyan + "44" }}>
      <div style={{ fontWeight: 700, color: C.cyan, marginBottom: 14 }}>Add Document</div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Car</label>
          <select style={S.input} value={form.carId} onChange={e => setForm(f => ({ ...f, carId: e.target.value }))}>
            {cars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>Type</label>
          <select style={S.input} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Expiry Date</label>
          <input type="date" style={S.input} value={form.expiry} onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>Notes</label>
          <input style={S.input} placeholder="policy number, etc." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      {form.expiry && (() => { const st = docStatus(form.expiry); return <div style={{ background: C.faint, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: st.color, fontWeight: 600 }}>{st.label}</div>; })()}
      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Licence Disc Photo (optional)</label>
        {form.photoPreview ? (
          <div style={{ position: "relative", display: "inline-block" }}>
            <img src={form.photoPreview} alt="Disc" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
            <button onClick={() => setForm(f => ({ ...f, photoFile: null, photoPreview: null }))}
              style={{ position: "absolute", top: 4, right: 4, background: "#000a", color: "#fff", border: "none", borderRadius: 99, width: 20, height: 20, cursor: "pointer", fontSize: 11 }}>✕</button>
          </div>
        ) : (
          <label htmlFor={fileInputId} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", border: `1px dashed ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.muted, fontSize: 12 }}>
            📎 Attach disc photo
          </label>
        )}
        <input id={fileInputId} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
      </div>
      <div style={S.row}>
        <button style={S.btn()} onClick={onSave} disabled={syncing || uploading}>{uploading ? "Uploading..." : syncing ? "Saving..." : "Save"}</button>
        <button style={S.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function IncidentForm({ form, setForm, cars, syncing, uploading, onSave, onCancel }) {
  const fileInputId = "incident-photos-input";

  function handlePhotosSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const previews = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }));
    setForm(f => ({ ...f, photoFiles: [...(f.photoFiles || []), ...previews] }));
    e.target.value = "";
  }

  function removePhoto(i) {
    setForm(f => ({ ...f, photoFiles: f.photoFiles.filter((_, idx) => idx !== i) }));
  }

  return (
    <div style={{ ...S.card, maxWidth: 540, marginBottom: 16, borderColor: C.red + "44" }}>
      <div style={{ fontWeight: 700, color: C.red, marginBottom: 14 }}>🚗 Log Accident / Damage</div>

      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Car</label>
          <select style={S.input} value={form.carId} onChange={e => setForm(f => ({ ...f, carId: e.target.value }))}>
            {cars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>Date of Incident</label>
          <input type="date" style={S.input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>What happened</label>
        <input style={S.input} placeholder="e.g. Rear-ended at intersection on Harare Drive" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>

      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Repair Shop</label>
          <input style={S.input} placeholder="e.g. Panel beaters name" value={form.repairShop} onChange={e => setForm(f => ({ ...f, repairShop: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>Status</label>
          <select style={S.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {INCIDENT_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Quotation Amount ($)</label>
          <input type="number" inputMode="numeric" style={S.input} placeholder="0.00" value={form.quotationAmount} onChange={e => setForm(f => ({ ...f, quotationAmount: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Actual Repair Cost ($)</label>
          <input type="number" inputMode="numeric" style={{ ...S.input, color: form.repairAmount ? C.red : C.muted }} placeholder="fill when done" value={form.repairAmount} onChange={e => setForm(f => ({ ...f, repairAmount: e.target.value }))} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Notes</label>
        <input style={S.input} placeholder="insurance claim number, fault details, etc." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Damage Photos & Quotation Documents</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {(form.photoFiles || []).map((p, i) => {
            const isPdf = p.file.type === "application/pdf" || p.file.name.toLowerCase().endsWith(".pdf");
            return (
              <div key={i} style={{ position: "relative" }}>
                {isPdf ? (
                  <div style={{ width: 80, height: 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, background: C.faint, borderRadius: 6, border: "1px solid " + C.border }}>
                    <span style={{ fontSize: 24 }}>📄</span>
                    <div style={{ fontSize: 8, color: C.muted, textAlign: "center", padding: "0 4px", wordBreak: "break-all" }}>{p.file.name.slice(0, 12)}</div>
                  </div>
                ) : (
                  <img src={p.preview} alt={"file " + (i + 1)} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6, border: "1px solid " + C.border }} />
                )}
                <button onClick={() => removePhoto(i)} style={{ position: "absolute", top: 2, right: 2, background: "#000a", color: "#fff", border: "none", borderRadius: 99, width: 18, height: 18, cursor: "pointer", fontSize: 10 }}>✕</button>
              </div>
            );
          })}
          <label htmlFor={fileInputId} style={{ width: 80, height: 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, border: "1px dashed " + C.border, borderRadius: 6, cursor: "pointer", color: C.muted, fontSize: 10 }}>
            <span style={{ fontSize: 20 }}>📎</span>Add
          </label>
        </div>
        <input id={fileInputId} type="file" accept="image/*,application/pdf" multiple onChange={handlePhotosSelect} style={{ display: "none" }} />
        <div style={{ fontSize: 10, color: C.muted }}>Photos, PDFs, or quotation documents — multiple allowed</div>
      </div>

      <div style={S.row}>
        <button style={S.btn(C.red)} onClick={onSave} disabled={syncing || uploading}>
          {uploading ? "Uploading photos..." : syncing ? "Saving..." : "Save Incident"}
        </button>
        <button style={S.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}


function NewCarForm({ newCar, setNewCar, syncing, onSave, onCancel, vehicleLabel }) {
  const vLabel = vehicleLabel || "Car";
  return (
    <div style={{ ...S.card, maxWidth: 420, marginBottom: 16, borderColor: C.cyan + "44" }}>
      <div style={{ fontWeight: 700, color: C.cyan, marginBottom: 14 }}>New {vLabel}</div>
      <div style={{ marginBottom: 12 }}><label style={S.label}>Name</label>
        <input style={S.input} placeholder="e.g. Car 3 (Silver)" value={newCar.name} onChange={e => setNewCar(n => ({ ...n, name: e.target.value }))} />
      </div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Weekly Rate ($)</label>
          <input type="number" style={S.input} value={newCar.weeklyRate} onChange={e => setNewCar(n => ({ ...n, weeklyRate: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>Colour</label>
          <input type="color" value={newCar.color} onChange={e => setNewCar(n => ({ ...n, color: e.target.value }))} style={{ height: 40, width: "100%", borderRadius: 8, border: "none", cursor: "pointer" }} />
        </div>
      </div>
      <div style={{ ...S.row, marginBottom: 14 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Starting Odometer (km)</label>
          <input type="number" style={S.input} placeholder="e.g. 45000" value={newCar.odometerBaseline} onChange={e => setNewCar(n => ({ ...n, odometerBaseline: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>As Of Date</label>
          <input type="date" style={S.input} value={newCar.odometerDate} onChange={e => setNewCar(n => ({ ...n, odometerDate: e.target.value }))} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
        Optional — set this to the car's actual odometer reading today, and FleetMate will add every km you log from here onward to show the true total.
      </div>
      <div style={S.row}>
        <button style={S.btn()} onClick={onSave} disabled={syncing}>{syncing ? "Saving..." : "Add " + vLabel}</button>
        <button style={S.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function OdometerEditForm({ car, value, setValue, syncing, onSave, onCancel }) {
  return (
    <div style={{ ...S.card, maxWidth: 420, marginBottom: 14, borderColor: C.cyan + "44" }}>
      <div style={{ fontWeight: 700, color: C.cyan, marginBottom: 14 }}>Set Odometer — {car.name}</div>
      <div style={{ ...S.row, marginBottom: 14 }}>
        <div style={{ flex: 1 }}><label style={S.label}>Odometer Reading (km)</label>
          <input type="number" style={S.input} placeholder="e.g. 52340" value={value.reading} onChange={e => setValue(v => ({ ...v, reading: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}><label style={S.label}>As Of Date</label>
          <input type="date" style={S.input} value={value.date} onChange={e => setValue(v => ({ ...v, date: e.target.value }))} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
        Set this whenever you check the car's real odometer, to keep FleetMate's total accurate. Weeks logged before this date won't be double-counted.
      </div>
      <div style={S.row}>
        <button style={S.btn()} onClick={onSave} disabled={syncing}>{syncing ? "Saving..." : "Save"}</button>
        <button style={S.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ServiceRecordForm({ car, alerts, form, setForm, syncing, uploading, onSave, onCancel }) {
  const fileInputId = `service-photo-${car.id}`;

  function handlePhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setForm(f => ({ ...f, photoFile: file, photoPreview: URL.createObjectURL(file) }));
  }

  const STICKER_ITEMS = [
    "Engine Oil Changed", "Gear Oil Changed", "Diff Oil Changed",
    "Oil Filter Changed", "Air Filter Changed", "Fuel Filter Changed",
  ];

  return (
    <div style={{ ...S.card, maxWidth: 460, marginBottom: 14, borderColor: C.green + "44" }}>
      <div style={{ fontWeight: 700, color: C.green, marginBottom: 14 }}>Add Service Record — {car.name}</div>

      {/* Photo — no capture= so Android lets you choose camera OR gallery */}
      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Photo of Service Sticker</label>
        {form.photoPreview ? (
          <div style={{ position: "relative", marginBottom: 8 }}>
            <img src={form.photoPreview} alt="Service sticker" style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 8, background: C.faint, border: `1px solid ${C.border}` }} />
            <button
              onClick={() => setForm(f => ({ ...f, photoFile: null, photoPreview: null }))}
              style={{ position: "absolute", top: 8, right: 8, background: "#000a", color: "#fff", border: "none", borderRadius: 99, width: 26, height: 26, cursor: "pointer", fontSize: 14 }}
            >✕</button>
          </div>
        ) : (
          <label htmlFor={fileInputId} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, height: 120, border: `1px dashed ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.muted, fontSize: 12 }}>
            <span style={{ fontSize: 22 }}>📷</span>
            Tap to take photo or choose from gallery
          </label>
        )}
        {/* No capture attribute — lets Android show both camera and gallery options */}
        <input id={fileInputId} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
      </div>

      {/* Date, odometer at service */}
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Date of Service</label>
          <input type="date" style={S.input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Odometer at Service (km)</label>
          <input type="number" inputMode="numeric" style={S.input} placeholder="e.g. 49500" value={form.odometerKm} onChange={e => setForm(f => ({ ...f, odometerKm: e.target.value }))} />
        </div>
      </div>

      {/* Next service due km — taken directly from the sticker */}
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Next Service Due (km) — from sticker</label>
        <input type="number" inputMode="numeric" style={{ ...S.input, color: C.cyan, fontWeight: 700 }} placeholder="e.g. 52000" value={form.nextServiceKm} onChange={e => setForm(f => ({ ...f, nextServiceKm: e.target.value }))} />
        {form.nextServiceKm && form.odometerKm && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            That's {(Number(form.nextServiceKm) - Number(form.odometerKm)).toLocaleString()} km from now
          </div>
        )}
      </div>

      {/* What alert this service resets */}
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Which maintenance alert does this reset?</label>
        <select style={S.input} value={form.alertId} onChange={e => setForm(f => ({ ...f, alertId: e.target.value }))}>
          <option value="">None / don't reset an alert</option>
          {alerts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>

      {/* Sticker checklist — what was actually done */}
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>What was done (tick from sticker)</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {STICKER_ITEMS.map(item => {
            const checked = (form.itemsDone || []).includes(item);
            return (
              <label key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: checked ? C.text : C.muted, cursor: "pointer", padding: "6px 10px", borderRadius: 6, background: checked ? C.green + "18" : C.faint, border: `1px solid ${checked ? C.green + "44" : C.border}` }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setForm(f => {
                      const current = f.itemsDone || [];
                      return { ...f, itemsDone: checked ? current.filter(i => i !== item) : [...current, item] };
                    });
                  }}
                  style={{ accentColor: C.green }}
                />
                {item}
              </label>
            );
          })}
        </div>
      </div>

      {/* Service type and garage */}
      <div style={{ ...S.row, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Service Type</label>
          <select style={S.input} value={form.serviceType || "A"} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value }))}>
            <option>A</option>
            <option>B</option>
            <option>C</option>
            <option>Full</option>
            <option>Other</option>
          </select>
        </div>
        <div style={{ flex: 2 }}>
          <label style={S.label}>Garage / Fitment Centre</label>
          <input style={S.input} placeholder="e.g. Transerv Fitment Centre" value={form.garage || ""} onChange={e => setForm(f => ({ ...f, garage: e.target.value }))} />
        </div>
      </div>

      {form.alertId && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, background: C.green + "11", borderRadius: 6, padding: "8px 10px" }}>
          ✓ Saving this will reset "{alerts.find(a => a.id === form.alertId)?.label}" countdown
          {form.nextServiceKm ? ` — next due at ${Number(form.nextServiceKm).toLocaleString()} km (from sticker)` : ` — last done marked at ${form.odometerKm || "0"} km`}.
        </div>
      )}

      <div style={S.row}>
        <button style={S.btn(C.green)} onClick={onSave} disabled={syncing || uploading}>
          {uploading ? "Uploading photo..." : syncing ? "Saving..." : "Save Record"}
        </button>
        <button style={S.ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

function Onboarding({ onComplete }) {
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleStart() {
    if (!selected) return;
    setSaving(true);
    await onComplete(selected, name.trim());
    setSaving(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 480, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.cyan, marginBottom: 8 }}>Welcome to FleetMate</div>
          <div style={{ color: C.muted, fontSize: 14 }}>Let's set up your fleet. What type of vehicles do you operate?</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {Object.entries(SECTORS).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setSelected(key)}
              style={{
                background: selected === key ? cfg.color + "22" : C.surface,
                border: "2px solid " + (selected === key ? cfg.color : C.border),
                borderRadius: 12, padding: "14px 18px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 14, textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 28 }}>{cfg.icon}</span>
              <div>
                <div style={{ fontWeight: 700, color: selected === key ? cfg.color : C.text, fontSize: 15 }}>{cfg.label}</div>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{cfg.desc}</div>
              </div>
              {selected === key && <span style={{ marginLeft: "auto", color: cfg.color, fontSize: 18 }}>✓</span>}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Your name or business name (optional)</label>
          <input
            style={S.input}
            placeholder="e.g. Vushe Transport"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <button
          onClick={handleStart}
          disabled={!selected || saving}
          style={{ ...S.btn(selected ? SECTORS[selected].color : C.border), width: "100%", padding: "14px", fontSize: 15, fontWeight: 800, opacity: selected ? 1 : 0.5 }}
        >
          {saving ? "Setting up..." : selected ? "Get Started with " + SECTORS[selected].label + " " + SECTORS[selected].icon : "Select a sector above"}
        </button>

        <div style={{ color: C.muted, fontSize: 11, textAlign: "center", marginTop: 16 }}>
          You can change this later in Settings · Free to start, upgrade anytime
        </div>
      </div>
    </div>
  );
}

function Dashboard({ cars, weeks, costs, allAlerts, docAlerts, paymentAlerts, missingWeekAlerts, carName, setView, sector }) {
  const [selectedMonth, setSelectedMonth] = useState("all");

  // Build the list of months that actually have data, newest first, plus "All Time"
  const availableMonths = useMemo(() => {
    const keys = new Set();
    weeks.forEach(w => keys.add(monthKey(w.week_start)));
    costs.forEach(c => keys.add(monthKey(c.date)));
    const sorted = [...keys].filter(Boolean).sort().reverse();
    return ["all", ...sorted];
  }, [weeks, costs]);

  const monthWeeks = selectedMonth === "all" ? weeks : weeks.filter(w => monthKey(w.week_start) === selectedMonth);
  const monthCosts = selectedMonth === "all" ? costs : costs.filter(c => monthKey(c.date) === selectedMonth);

  const monthCarStats = useMemo(() => cars.map(car => {
    const cw = monthWeeks.filter(w => w.car_id === car.id);
    const cc = monthCosts.filter(c => c.car_id === car.id);
    const totalKm       = cw.reduce((s, w) => s + Number(w.km || 0), 0);
    const totalReceived = cw.filter(w => w.paid).reduce((s, w) => s + Number(w.amount || 0), 0);
    const totalCosts    = cc.reduce((s, c) => s + Number(c.amount || 0), 0);
    const net           = totalReceived - totalCosts;
    const perKm         = totalKm > 0 ? totalReceived / totalKm : 0;
    const avgWeeklyKm   = cw.length > 0 ? totalKm / cw.length : 0;
    const unpaidCount   = cw.filter(w => !w.paid).length;
    const unpaidAmt     = cw.filter(w => !w.paid).reduce((s, w) => s + Number(w.amount || 0), 0);
    return { car, totalKm, totalReceived, totalCosts, net, perKm, avgWeeklyKm, unpaidCount, unpaidAmt, weekCount: cw.length, costCount: cc.length };
  }), [cars, monthWeeks, monthCosts]);

  const totKm  = monthCarStats.reduce((s, c) => s + c.totalKm, 0);
  const totRec = monthCarStats.reduce((s, c) => s + c.totalReceived, 0);
  const totCost= monthCarStats.reduce((s, c) => s + c.totalCosts, 0);
  const totNet = totRec - totCost;
  const totWeekCount = monthCarStats.reduce((s, c) => s + c.weekCount, 0);
  const totCostCount = monthCarStats.reduce((s, c) => s + c.costCount, 0);

  // Flag months that look like they're missing data — earnings logged but zero costs at all,
  // which for an operating fleet usually means costs weren't entered, not that there were none.
  const looksIncomplete = selectedMonth !== "all" && totWeekCount > 0 && totCostCount === 0;

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={S.title}>Fleet Dashboard</div>
          <div style={S.sub}>{cars.length} {getSectorCfg(sector).vehiclesLabel} · {monthLabel(selectedMonth)}
            {selectedMonth === "all" && weeks.length > 0 && (() => {
              const dates = weeks.map(w => w.week_start).sort();
              const first = new Date(dates[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              const last = new Date(today()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              return <span style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>({first} – {last})</span>;
            })()}
          </div>
        </div>
        <select
          style={{ ...S.input, width: "auto", minWidth: 160 }}
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
        >
          {availableMonths.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}
        </select>
      </div>

      {looksIncomplete && (
        <div style={{ ...S.card, borderColor: C.amber, marginBottom: 16, fontSize: 12, color: C.amber }}>
          ℹ {monthLabel(selectedMonth)} has {totWeekCount} week{totWeekCount !== 1 ? "s" : ""} logged but no costs recorded.
          If you had any expenses this month, they're probably just not entered yet — these numbers may look
          better than reality until they are.
        </div>
      )}

      {(allAlerts.length > 0 || docAlerts.length > 0 || paymentAlerts.length > 0 || missingWeekAlerts.length > 0) && (
        <div style={{ ...S.card, borderColor: (allAlerts.some(a => a.status === "due") || docAlerts.some(d => d.level === "expired" || d.level === "critical") || paymentAlerts.length > 0) ? C.red : C.amber, marginBottom: 16 }}>
          {allAlerts.length > 0 && <>
            <div style={{ fontWeight: 700, color: allAlerts.some(a => a.status === "due") ? C.red : C.amber, marginBottom: 8, fontSize: 13 }}>
              {allAlerts.some(a => a.status === "due") ? "⚠ Maintenance Overdue" : "⏳ Maintenance Due Soon"}
            </div>
            {allAlerts.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: a.status === "due" ? C.red : C.amber, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
                <span><strong>{a.car.name}</strong> — {a.alert.label}</span>
                <span style={{ color: C.muted }}>{a.status === "due" ? `${fmtKm(Math.abs(a.remaining))} overdue` : `${fmtKm(a.remaining)} left`}</span>
              </div>
            ))}
          </>}
          {docAlerts.length > 0 && <>
            {allAlerts.length > 0 && <div style={{ borderTop: `1px solid ${C.border}`, margin: "10px 0" }} />}
            <div style={{ fontWeight: 700, color: docAlerts.some(d => d.level === "expired") ? C.red : C.amber, marginBottom: 8, fontSize: 13 }}>
              📋 {docAlerts.some(d => d.level === "expired") ? "Documents Expired" : "Documents Expiring Soon"}
            </div>
            {docAlerts.map(d => (
              <div key={d.id} style={{ fontSize: 12, color: d.color, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
                <span><strong>{carName(d.car_id)}</strong> — {d.type}</span>
                <span style={{ color: C.muted }}>{d.label}</span>
              </div>
            ))}
          </>}
          {paymentAlerts.length > 0 && <>
            {(allAlerts.length > 0 || docAlerts.length > 0) && <div style={{ borderTop: `1px solid ${C.border}`, margin: "10px 0" }} />}
            <div style={{ fontWeight: 700, color: C.red, marginBottom: 8, fontSize: 13 }}>
              💰 Payment Overdue
            </div>
            {paymentAlerts.map(w => (
              <div key={w.id} style={{ fontSize: 12, color: C.red, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
                <span><strong>{carName(w.car_id)}</strong> — week ending {new Date(w.endStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                <span style={{ color: C.muted }}>{w.daysSinceEnd}d unpaid · {fmt(w.amount)}</span>
              </div>
            ))}
          </>}
          {missingWeekAlerts.length > 0 && <>
            {(allAlerts.length > 0 || docAlerts.length > 0 || paymentAlerts.length > 0) && <div style={{ borderTop: `1px solid ${C.border}`, margin: "10px 0" }} />}
            <div style={{ fontWeight: 700, color: C.amber, marginBottom: 8, fontSize: 13 }}>
              📋 Week Possibly Not Logged
            </div>
            {missingWeekAlerts.map(({ car, latestEndStr, daysSinceLastWeek }) => (
              <div key={car.id} style={{ fontSize: 12, color: C.amber, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
                <span><strong>{car.name}</strong> — last week ended {new Date(latestEndStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                <span style={{ color: C.muted }}>{daysSinceLastWeek}d ago — new week due?</span>
              </div>
            ))}
          </>}
        </div>
      )}

      <div style={{ ...S.row, marginBottom: 16 }}>
        <Stat label="Total Received" value={fmt(totRec)} color={C.green} />
        <Stat label="Total Costs" value={fmt(totCost)} color={C.red} />
        <Stat label="Net Profit" value={fmt(totNet)} color={totNet >= 0 ? C.green : C.red} />
        <Stat label="Fleet km" value={fmtKm(totKm)} color={C.cyan} />
      </div>

      <div style={{ ...S.row, marginBottom: 16 }}>
        {monthCarStats.map(({ car, totalKm, totalReceived, totalCosts, net, perKm, avgWeeklyKm, unpaidCount, unpaidAmt }) => {
          const odo = currentOdometer(car, weeks); // odometer is always true total-to-date, not month-scoped
          const maxPK = Math.max(...monthCarStats.map(s => s.perKm), 0.001);
          return (
            <div key={car.id} style={{ ...S.card, flex: 1, minWidth: 240, borderTop: `3px solid ${car.color}` }}>
              <div style={{ fontWeight: 700, color: car.color, fontSize: 15, marginBottom: 12 }}>{car.name}</div>
              <div style={{ ...S.row, marginBottom: 12 }}>
                <Stat label="Received" value={fmt(totalReceived)} color={C.green} small />
                <Stat label="Costs" value={fmt(totalCosts)} color={C.red} small />
                <Stat label="Net" value={fmt(net)} color={net >= 0 ? C.green : C.red} small />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>Earnings per km</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.amber, fontFamily: "monospace" }}>{fmtRate(perKm)}</span>
                </div>
                <div style={{ height: 6, background: C.border, borderRadius: 99 }}>
                  <div style={{ height: 6, borderRadius: 99, width: `${(perKm / maxPK) * 100}%`, background: C.amber }} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 2 }}>
                <div>Odometer: <strong style={{ color: C.cyan }}>{fmtKm(odo)}</strong> · Avg/wk: <strong style={{ color: C.text }}>{fmtKm(avgWeeklyKm)}</strong></div>
                {unpaidCount > 0 && <div style={{ color: C.red }}>{unpaidCount} unpaid week{unpaidCount > 1 ? "s" : ""} · {fmt(unpaidAmt)}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Weekly Mileage — Last 12 Weeks</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Always shows recent trend regardless of the month selected above</div>
        <WeeklyBars weeks={weeks} cars={cars} />
      </div>
    </div>
  );
}

function Weekly({
  weeks, cars, filterCar, setFilterCar, carColor, carName, togglePaid, del, setWeeks,
  showW, setShowW, wForm, setWForm, editingWeekId, setEditingWeekId,
  activeDay, setActiveDay, syncing, blankDaily,
  onSaveWeek, onCancelWeekForm, onStartEditWeek,
}) {
  const filtered = weeks.filter(w => filterCar === "all" || w.car_id === filterCar);
  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div><div style={S.title}>Weekly Log</div><div style={S.sub}>Mileage + payment per week</div></div>
        <div style={S.row}>
          <select style={{ ...S.input, width: "auto" }} value={filterCar} onChange={e => setFilterCar(e.target.value)}>
            <option value="all">All Cars</option>
            {cars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button style={S.btn()} onClick={() => { setEditingWeekId(null); setWForm(blankDaily()); setShowW(v => !v); }}>+ Add Week</button>
        </div>
      </div>

      {showW && (
        <WeekForm
          wForm={wForm} setWForm={setWForm} cars={cars}
          editingWeekId={editingWeekId} activeDay={activeDay} setActiveDay={setActiveDay}
          syncing={syncing} onSave={onSaveWeek} onCancel={onCancelWeekForm}
        />
      )}

      <div style={{ ...S.card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={S.th}>Week</th><th style={S.th}>Car</th><th style={S.th}>Mileage</th>
              <th style={S.th}>Payment</th><th style={S.th}>$/km</th><th style={S.th}>Status</th>
              <th style={S.th}>Notes</th><th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(w => {
              const pk = w.km > 0 ? w.amount / w.km : 0;
              return (
                <tr key={w.id} onMouseEnter={e => e.currentTarget.style.background = C.faint} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ ...S.td, color: "#f8fafc", fontWeight: 600 }}>{fmtWeekRange(w.week_start, w.week_end)}</td>
                  <td style={S.td}><span style={{ color: carColor(w.car_id), fontWeight: 600 }}>{carName(w.car_id)}</span></td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: C.cyan }}>{fmtKm(w.km)}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: C.green, fontWeight: 700 }}>{fmt(w.amount)}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: C.amber }}>{pk > 0 ? fmtRate(pk) : "—"}</td>
                  <td style={S.td}>
                    <button onClick={() => togglePaid(w.id, w.paid)} style={{ background: w.paid ? C.green + "22" : C.amber + "22", color: w.paid ? C.green : C.amber, border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {w.paid ? "✓ Paid" : "Pending"}
                    </button>
                  </td>
                  <td style={{ ...S.td, color: C.muted, maxWidth: 140 }}>{w.notes}</td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => onStartEditWeek(w)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13 }} title="Edit">✎</button>
                      <button onClick={() => del("weeks", w.id, setWeeks)} style={{ background: "none", border: "none", color: C.border, cursor: "pointer" }} title="Delete">✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (() => {
            const tk = filtered.reduce((s, w) => s + Number(w.km), 0);
            const ta = filtered.filter(w => w.paid).reduce((s, w) => s + Number(w.amount), 0);
            return (
              <tfoot>
                <tr style={{ background: C.faint }}>
                  <td style={{ ...S.td, fontWeight: 700 }} colSpan={2}>Totals ({filtered.length} weeks)</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: C.cyan, fontWeight: 700 }}>{fmtKm(tk)}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: C.green, fontWeight: 700 }}>{fmt(ta)}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", color: C.amber, fontWeight: 700 }}>{tk > 0 ? fmtRate(ta / tk) : "—"}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>
    </div>
  );
}

function Costs({
  costs, cars, filterCar, setFilterCar, carColor, carName, del, setCosts,
  showC, setShowC, cForm, setCForm, editingCostId, setEditingCostId,
  syncing, blankCost, onSaveCost, onCancelCostForm, onStartEditCost,
}) {
  const filtered = costs.filter(c => filterCar === "all" || c.car_id === filterCar);
  const total = filtered.reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div><div style={S.title}>Costs</div><div style={S.sub}>What you spend · <strong style={{ color: C.red }}>{fmt(total)}</strong></div></div>
        <div style={S.row}>
          <select style={{ ...S.input, width: "auto" }} value={filterCar} onChange={e => setFilterCar(e.target.value)}>
            <option value="all">All Cars</option>
            {cars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button style={S.btn(C.red)} onClick={() => { setEditingCostId(null); setCForm(blankCost); setShowC(v => !v); }}>+ Add Cost</button>
        </div>
      </div>

      {showC && (
        <CostForm
          cForm={cForm} setCForm={setCForm} cars={cars}
          editingCostId={editingCostId} syncing={syncing}
          onSave={onSaveCost} onCancel={onCancelCostForm}
        />
      )}

      <div style={{ ...S.card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr><th style={S.th}>Date</th><th style={S.th}>Car</th><th style={S.th}>Amount</th><th style={S.th}>Category</th><th style={S.th}>Description</th><th style={S.th}></th></tr></thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} onMouseEnter={e => e.currentTarget.style.background = C.faint} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ ...S.td, color: "#f8fafc" }}>{c.date}</td>
                <td style={S.td}><span style={{ color: carColor(c.car_id), fontWeight: 600 }}>{carName(c.car_id)}</span></td>
                <td style={{ ...S.td, color: C.red, fontWeight: 700, fontFamily: "monospace" }}>{fmt(c.amount)}</td>
                <td style={S.td}><span style={{ background: C.faint, borderRadius: 6, padding: "2px 8px", fontSize: 11 }}>{c.category}</span></td>
                <td style={{ ...S.td, color: C.muted }}>{c.notes}</td>
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => onStartEditCost(c)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13 }} title="Edit">✎</button>
                    <button onClick={() => del("costs", c.id, setCosts)} style={{ background: "none", border: "none", color: C.border, cursor: "pointer" }} title="Delete">✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Maintenance({
  cars, weeks, markDone, serviceRecords,
  showServiceForm, setShowServiceForm, serviceForm, setServiceForm,
  syncing, uploadingPhoto, onSaveServiceRecord, onDeleteServiceRecord,
}) {
  return (
    <div style={S.page}>
      <div style={S.title}>Maintenance</div>
      <div style={S.sub}>Mileage-based service reminders + service book</div>
      {cars.map(car => {
        const km = currentOdometer(car, weeks);
        const carRecords = serviceRecords.filter(r => r.car_id === car.id).sort((a, b) => new Date(b.date) - new Date(a.date));
        const isAdding = showServiceForm === car.id;
        return (
          <div key={car.id} style={{ ...S.card, marginBottom: 16, borderTop: `3px solid ${car.color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontWeight: 700, color: car.color, fontSize: 15 }}>{car.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 12, color: C.muted }}>Odometer: <strong style={{ color: C.cyan }}>{fmtKm(km)}</strong></span>
                <button
                  style={{ ...S.btn(C.green), padding: "5px 12px", fontSize: 11 }}
                  onClick={() => {
                    setShowServiceForm(isAdding ? null : car.id);
                    setServiceForm({ alertId: car.alerts?.[0]?.id || "", date: today(), odometerKm: String(km), nextServiceKm: "", itemsDone: [], serviceType: "A", garage: "", notes: "", photoFile: null, photoPreview: null });
                  }}
                >
                  {isAdding ? "Cancel" : "📷 Add Service Record"}
                </button>
              </div>
            </div>

            {isAdding && (
              <ServiceRecordForm
                car={car} alerts={car.alerts || []} form={serviceForm} setForm={setServiceForm}
                syncing={syncing} uploading={uploadingPhoto}
                onSave={() => onSaveServiceRecord(car)}
                onCancel={() => setShowServiceForm(null)}
              />
            )}

            {(car.alerts || []).map(a => {
              const kmSince = km - a.lastDoneKm;
              const remaining = a.intervalKm - kmSince;
              const status = remaining <= 0 ? "due" : remaining <= a.intervalKm * 0.15 ? "soon" : "ok";
              return (
                <div key={a.id} style={{ marginBottom: 12, padding: "10px 12px", background: C.faint, borderRadius: 8, borderLeft: `3px solid ${status === "due" ? C.red : status === "soon" ? C.amber : C.border}` }}>
                  <AlertBar alert={a} kmTotal={km} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 11, color: C.muted }}>
                    <span>Every {fmtKm(a.intervalKm)} · Last at {fmtKm(a.lastDoneKm)}</span>
                    {status !== "ok" && <button style={{ ...S.btn(C.green), padding: "4px 12px", fontSize: 11 }} onClick={() => markDone(car.id, a.id)}>✓ Mark Done</button>}
                  </div>
                </div>
              );
            })}

            {carRecords.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 }}>Service History</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {carRecords.map(r => (
                    <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", background: C.faint, borderRadius: 8, padding: 8 }}>
                      {r.photo_url ? (
                        <a href={r.photo_url} target="_blank" rel="noopener noreferrer">
                          <img src={r.photo_url} alt="Service sticker" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.border}` }} />
                        </a>
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 6, background: C.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📋</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{r.alert_label || "Service"} — {fmtKm(r.odometer_km)}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>
                          {new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          {r.notes ? ` · ${r.notes}` : ""}
                        </div>
                      </div>
                      <button onClick={() => onDeleteServiceRecord(r.id)} style={{ background: "none", border: "none", color: C.border, cursor: "pointer", flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Docs({ docs, cars, del, setDocs, showForm, setShowForm, form, setForm, syncing, uploading, onSaveDoc,
  incidents, setIncidents, incidentForm, setIncidentForm, showIncidentForm, setShowIncidentForm,
  onSaveIncident, updateIncidentStatus, carName, carColor, onStartEditIncident, editingIncidentId }) {
  const grouped = cars.map(car => {
    const carDocs = docs.filter(d => d.car_id === car.id);
    // Group by document type, sort each group newest-expiry-first so [0] is always "current"
    const byType = {};
    carDocs.forEach(d => {
      if (!byType[d.type]) byType[d.type] = [];
      byType[d.type].push(d);
    });
    Object.values(byType).forEach(arr => arr.sort((a, b) => new Date(b.expiry) - new Date(a.expiry)));
    return { car, byType };
  });

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div><div style={S.title}>Documents</div><div style={S.sub}>Insurance, ZINARA, roadworthy</div></div>
        <button style={S.btn()} onClick={() => setShowForm(v => !v)}>+ Add</button>
      </div>

      {showForm && (
        <DocForm form={form} setForm={setForm} cars={cars} syncing={syncing} uploading={uploading} onSave={onSaveDoc} onCancel={() => setShowForm(false)} />
      )}

      {grouped.map(({ car, byType }) => (
        <div key={car.id} style={{ ...S.card, marginBottom: 16, borderTop: `3px solid ${car.color}` }}>
          <div style={{ fontWeight: 700, color: car.color, fontSize: 15, marginBottom: 14 }}>{car.name}</div>
          {Object.keys(byType).length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No documents yet.</div>}
          {Object.entries(byType).map(([type, entries]) => {
            const current = entries[0];
            const history = entries.slice(1);
            const st = docStatus(current.expiry);
            return (
              <div key={type} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 8, background: C.faint, borderLeft: `3px solid ${st.color}` }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{type}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Expires: {new Date(current.expiry).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{current.notes ? ` · ${current.notes}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.color + "18", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>{st.label}</span>
                    <button onClick={() => del("docs", current.id, setDocs)} style={{ background: "none", border: "none", color: C.border, cursor: "pointer" }}>✕</button>
                  </div>
                </div>
                {history.length > 0 && (
                  <details style={{ marginTop: 4, marginLeft: 12 }}>
                    <summary style={{ fontSize: 11, color: C.muted, cursor: "pointer" }}>
                      {history.length} older {type} record{history.length > 1 ? "s" : ""}
                    </summary>
                    {history.map(d => (
                      <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", marginTop: 4, borderRadius: 6, background: C.bg, fontSize: 11, color: C.muted }}>
                        <span>Expired: {new Date(d.expiry).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{d.notes ? ` · ${d.notes}` : ""}</span>
                        <button onClick={() => del("docs", d.id, setDocs)} style={{ background: "none", border: "none", color: C.border, cursor: "pointer" }}>✕</button>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Accident / Damage Records */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.red }}>🚗 Accidents & Damage</div>
            <div style={{ fontSize: 12, color: C.muted }}>Repair quotations, status, and photos</div>
          </div>
          <button style={S.btn(C.red)} onClick={() => setShowIncidentForm(v => !v)}>+ Log Incident</button>
        </div>

        {showIncidentForm && (
          <IncidentForm
            form={incidentForm} setForm={setIncidentForm} cars={cars}
            syncing={syncing} uploading={uploading}
            onSave={onSaveIncident} onCancel={() => setShowIncidentForm(false)}
          />
        )}

        {incidents.length === 0 && !showIncidentForm && (
          <div style={{ ...S.card, color: C.muted, fontSize: 13 }}>No incidents logged yet.</div>
        )}

        {incidents.map(inc => {
          const statusColor = inc.status === "Done" ? C.green : inc.status === "In Repair" ? C.cyan : inc.status === "Approved" ? C.amber : C.red;
          const isEditing = editingIncidentId === inc.id;
          return (
            <div key={inc.id}>
              {isEditing && (
                <IncidentForm
                  form={incidentForm} setForm={setIncidentForm} cars={cars}
                  syncing={syncing} uploading={uploading}
                  onSave={onSaveIncident} onCancel={() => onStartEditIncident(null)}
                />
              )}
            <div key={inc.id} style={{ ...S.card, marginBottom: 12, borderLeft: `4px solid ${statusColor}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{inc.description}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    <span style={{ color: carColor(inc.car_id), fontWeight: 600 }}>{carName(inc.car_id)}</span>
                    {" · "}{inc.date}{inc.repair_shop ? ` · ${inc.repair_shop}` : ""}
                  </div>
                </div>
                <select
                  value={inc.status}
                  onChange={e => updateIncidentStatus(inc.id, e.target.value)}
                  style={{ ...S.input, width: "auto", fontSize: 11, padding: "4px 8px", color: statusColor, borderColor: statusColor + "44" }}
                >
                  {INCIDENT_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              <div style={{ ...S.row, marginBottom: inc.photo_urls?.length ? 10 : 0 }}>
                {inc.quotation_amount && (
                  <div style={{ background: C.faint, borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: C.muted, fontSize: 10, marginBottom: 2 }}>QUOTATION</div>
                    <div style={{ color: C.amber, fontWeight: 700, fontFamily: "monospace" }}>{fmt(inc.quotation_amount)}</div>
                  </div>
                )}
                {inc.repair_amount && (
                  <div style={{ background: C.faint, borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: C.muted, fontSize: 10, marginBottom: 2 }}>ACTUAL COST</div>
                    <div style={{ color: C.red, fontWeight: 700, fontFamily: "monospace" }}>{fmt(inc.repair_amount)}</div>
                  </div>
                )}
                {inc.quotation_amount && inc.repair_amount && (
                  <div style={{ background: C.faint, borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                    <div style={{ color: C.muted, fontSize: 10, marginBottom: 2 }}>VARIANCE</div>
                    <div style={{ color: inc.repair_amount > inc.quotation_amount ? C.red : C.green, fontWeight: 700, fontFamily: "monospace" }}>
                      {inc.repair_amount > inc.quotation_amount ? "+" : ""}{fmt(inc.repair_amount - inc.quotation_amount)}
                    </div>
                  </div>
                )}
              </div>

              {inc.photo_urls?.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {inc.photo_urls.map((url, i) => {
                    const isPdf = url.toLowerCase().includes(".pdf") || url.toLowerCase().includes("application%2Fpdf");
                    return (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        {isPdf ? (
                          <div style={{ width: 64, height: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, background: C.faint, borderRadius: 6, border: "1px solid " + C.border }}>
                            <span style={{ fontSize: 22 }}>📄</span>
                            <span style={{ fontSize: 8, color: C.cyan }}>View PDF</span>
                          </div>
                        ) : (
                          <img src={url} alt={"file " + (i + 1)} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid " + C.border }} />
                        )}
                      </a>
                    );
                  })}
                </div>
              )}

              {inc.notes && <div style={{ fontSize: 11, color: C.muted }}>{inc.notes}</div>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <button onClick={() => onStartEditIncident(inc)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 11 }}>✎ Edit</button>
                <button onClick={() => del("incidents", inc.id, setIncidents)} style={{ background: "none", border: "none", color: C.border, cursor: "pointer", fontSize: 11 }}>Delete</button>
              </div>
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Cars({
  cars, weeks, carStats, showAddCar, setShowAddCar, newCar, setNewCar, syncing,
  onAddCar, editingOdoCarId, setEditingOdoCarId, odoForm, setOdoForm, onSaveOdometer, cfg,
}) {
  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div><div style={S.title}>My {cfg.vehiclesLabel}</div><div style={S.sub}>Manage your fleet</div></div>
        <button style={S.btn()} onClick={() => setShowAddCar(v => !v)}>+ Add {cfg.vehicleLabel}</button>
      </div>

      {showAddCar && (
        <NewCarForm newCar={newCar} setNewCar={setNewCar} syncing={syncing} onSave={onAddCar} onCancel={() => setShowAddCar(false)} vehicleLabel={cfg.vehicleLabel} />
      )}

      {carStats.map(({ car, totalKm, totalReceived, totalCosts, net, perKm, avgWeeklyKm }) => {
        const odo = currentOdometer(car, weeks);
        const isEditingOdo = editingOdoCarId === car.id;
        return (
          <div key={car.id} style={{ marginBottom: 14 }}>
            <div style={{ ...S.card, borderLeft: `4px solid ${car.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, color: car.color, fontSize: 15 }}>{car.name}</div>
                <button
                  style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.cyan, fontSize: 11, padding: "4px 10px", cursor: "pointer" }}
                  onClick={() => {
                    setEditingOdoCarId(isEditingOdo ? null : car.id);
                    setOdoForm({ reading: String(odo), date: today() });
                  }}
                >
                  {isEditingOdo ? "Cancel" : "Set Odometer"}
                </button>
              </div>
              <div style={S.row}>
                <Stat label="Odometer" value={fmtKm(odo)} color={C.cyan} small />
                <Stat label="Received" value={fmt(totalReceived)} color={C.green} small />
                <Stat label="Costs" value={fmt(totalCosts)} color={C.red} small />
                <Stat label="Net" value={fmt(net)} color={net >= 0 ? C.green : C.red} small />
                <Stat label="$/km" value={fmtRate(perKm)} color={C.amber} small />
                <Stat label="Avg/wk" value={fmtKm(avgWeeklyKm)} color={C.muted} small />
              </div>
            </div>
            {isEditingOdo && (
              <OdometerEditForm
                car={car} value={odoForm} setValue={setOdoForm} syncing={syncing}
                onSave={() => onSaveOdometer(car.id)}
                onCancel={() => setEditingOdoCarId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN APP — owns all state, wires it into the page components above
// ════════════════════════════════════════════════════════════════════════════

export default function App({ session }) {
  const userId = session.user.id;

  const [cars, setCars]   = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [costs, setCosts] = useState([]);
  const [docs, setDocs]   = useState([]);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [view, setView] = useState("dashboard");
  const [filterCar, setFilterCar] = useState("all");
  const [toast, setToast] = useState("");
  const [activeDay, setActiveDay] = useState(null);

  const blankDaily = () => ({ carId: cars[0]?.id || "", weekStart: getMondayStr(), weekEnd: getSundayStr(getMondayStr()), entryMode: "daily", totalKm: "", days: Array(7).fill(""), amount: "", paid: true, notes: "" });
  const blankCost = { carId: cars[0]?.id || "", date: today(), amount: "", category: "Service & Insurance", notes: "" };
  const blankDoc = { carId: cars[0]?.id || "", type: DOC_TYPES[0], expiry: "", notes: "" };

  const [wForm, setWForm] = useState(blankDaily);
  const [editingWeekId, setEditingWeekId] = useState(null);
  const [cForm, setCForm] = useState(blankCost);
  const [editingCostId, setEditingCostId] = useState(null);
  const [docForm, setDocForm] = useState(blankDoc);
  const [showW, setShowW] = useState(false);
  const [showC, setShowC] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [showAddCar, setShowAddCar] = useState(false);
  const [newCar, setNewCar] = useState({ name: "", color: C.cyan, weeklyRate: 130, odometerBaseline: "", odometerDate: today() });
  const [editingOdoCarId, setEditingOdoCarId] = useState(null);
  const [odoForm, setOdoForm] = useState({ reading: "", date: today() });
  const [showServiceForm, setShowServiceForm] = useState(null); // holds the car.id currently adding a record, or null
  const [serviceForm, setServiceForm] = useState({ alertId: "", date: today(), odometerKm: "", nextServiceKm: "", itemsDone: [], serviceType: "A", garage: "", notes: "", photoFile: null, photoPreview: null });
  const blankIncident = () => ({ carId: cars[0]?.id || "", date: today(), description: "", repairShop: "", status: "Quoted", quotationAmount: "", repairAmount: "", notes: "", photoFiles: [] });
  const [incidentForm, setIncidentForm] = useState({ carId: "", date: today(), description: "", repairShop: "", status: "Quoted", quotationAmount: "", repairAmount: "", notes: "", photoFiles: [] });
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [editingIncidentId, setEditingIncidentId] = useState(null);

  function toast_(m) { setToast(m); setTimeout(() => setToast(""), 2500); }
  const carColor = (id) => cars.find(c => c.id === id)?.color || C.muted;
  const carName  = (id) => cars.find(c => c.id === id)?.name || "—";

  // ── Load all data ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const [carsRes, weeksRes, costsRes, docsRes, serviceRes, incidentRes, profileRes] = await Promise.all([
        supabase.from("cars").select("*").eq("user_id", userId).order("created_at"),
        supabase.from("weeks").select("*").eq("user_id", userId).order("week_start", { ascending: false }),
        supabase.from("costs").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("docs").select("*").eq("user_id", userId).order("expiry"),
        supabase.from("service_records").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("incidents").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("profiles").select("*").eq("id", userId).single(),
      ]);
      if (carsRes.data)  setCars(carsRes.data);
      if (weeksRes.data) setWeeks(weeksRes.data);
      if (costsRes.data) setCosts(costsRes.data);
      if (docsRes.data)  setDocs(docsRes.data);
      if (serviceRes.data) setServiceRecords(serviceRes.data);
      if (incidentRes.data) setIncidents(incidentRes.data);
      if (profileRes.data) setProfile(profileRes.data);
      setLoading(false);
    }
    fetchAll();
  }, [userId]);

  useEffect(() => {
    if (cars.length && !wForm.carId) {
      setWForm(f => ({ ...f, carId: cars[0].id }));
      setCForm(f => ({ ...f, carId: cars[0].id }));
      setDocForm(f => ({ ...f, carId: cars[0].id }));
    }
  }, [cars]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const carStats = useMemo(() => cars.map(car => {
    const cw = weeks.filter(w => w.car_id === car.id);
    const cc = costs.filter(c => c.car_id === car.id);
    const totalKm       = cw.reduce((s, w) => s + Number(w.km || 0), 0);
    const totalReceived = cw.filter(w => w.paid).reduce((s, w) => s + Number(w.amount || 0), 0);
    const totalCosts    = cc.reduce((s, c) => s + Number(c.amount || 0), 0);
    const net           = totalReceived - totalCosts;
    const perKm         = totalKm > 0 ? totalReceived / totalKm : 0;
    const avgWeeklyKm   = cw.length > 0 ? totalKm / cw.length : 0;
    const unpaidCount   = cw.filter(w => !w.paid).length;
    const unpaidAmt     = cw.filter(w => !w.paid).reduce((s, w) => s + Number(w.amount || 0), 0);
    return { car, totalKm, totalReceived, totalCosts, net, perKm, avgWeeklyKm, unpaidCount, unpaidAmt };
  }), [cars, weeks, costs]);

  const allAlerts = useMemo(() => {
    const out = [];
    cars.forEach(car => {
      const km = currentOdometer(car, weeks);
      (car.alerts || []).forEach(a => {
        const kmSince = km - a.lastDoneKm;
        const remaining = a.intervalKm - kmSince;
        const status = remaining <= 0 ? "due" : remaining <= a.intervalKm * 0.15 ? "soon" : "ok";
        if (status !== "ok") out.push({ car, alert: a, status, remaining, km });
      });
    });
    return out;
  }, [cars, weeks]);

  const docAlerts = useMemo(() => {
    // Group by car + document type, keep only the one with the furthest-out expiry date —
    // that's the active/current one. Older entries of the same type are history, not alerts.
    const latestByKey = {};
    docs.forEach(d => {
      const key = `${d.car_id}::${d.type}`;
      if (!latestByKey[key] || new Date(d.expiry) > new Date(latestByKey[key].expiry)) {
        latestByKey[key] = d;
      }
    });
    return Object.values(latestByKey)
      .map(d => ({ ...d, ...docStatus(d.expiry) }))
      .filter(d => d.level !== "ok")
      .sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
  }, [docs]);

  // Payment overdue alerts — week logged as Pending and week_end was more than 3 days ago
  const paymentAlerts = useMemo(() => {
    const todayStr = today();
    return weeks
      .filter(w => !w.paid)
      .map(w => {
        const endStr = w.week_end || addDaysStr(w.week_start, 6);
        const daysSinceEnd = Math.floor((new Date(todayStr) - new Date(endStr)) / 86400000);
        return { ...w, endStr, daysSinceEnd };
      })
      .filter(w => w.daysSinceEnd > 3) // grace period of 3 days
      .sort((a, b) => b.daysSinceEnd - a.daysSinceEnd);
  }, [weeks]);

  // Missing week alerts — a car has no week logged in the last 10 days
  const missingWeekAlerts = useMemo(() => {
    const todayStr = today();
    return cars.map(car => {
      const carWeeks = weeks.filter(w => w.car_id === car.id);
      if (carWeeks.length === 0) return null; // never logged anything, not an alert yet
      const latestWeek = carWeeks.reduce((latest, w) =>
        (w.week_end || w.week_start) > (latest.week_end || latest.week_start) ? w : latest
      );
      const latestEndStr = latestWeek.week_end || addDaysStr(latestWeek.week_start, 6);
      const daysSinceLastWeek = Math.floor((new Date(todayStr) - new Date(latestEndStr)) / 86400000);
      if (daysSinceLastWeek > 10) return { car, latestEndStr, daysSinceLastWeek };
      return null;
    }).filter(Boolean);
  }, [cars, weeks]);

  async function handleSaveWeek() {
    const totalKm = wForm.entryMode === "total"
      ? Number(wForm.totalKm) || 0
      : wForm.days.reduce((s, d) => s + (Number(d) || 0), 0);
    if (!wForm.carId || !wForm.weekStart || !wForm.weekEnd || totalKm === 0 || !wForm.amount) return;
    setSyncing(true);

    const dailyKmToStore = wForm.entryMode === "total" ? null : wForm.days;

    if (editingWeekId) {
      const updates = { car_id: wForm.carId, week_start: wForm.weekStart, week_end: wForm.weekEnd, km: totalKm, daily_km: dailyKmToStore, amount: Number(wForm.amount), paid: wForm.paid, notes: wForm.notes };
      const { data, error } = await supabase.from("weeks").update(updates).eq("id", editingWeekId).select().single();
      if (!error) {
        setWeeks(w => w.map(x => x.id === editingWeekId ? data : x));
        toast_(`✓ Week updated — ${totalKm.toFixed(0)} km`);
        setShowW(false); setWForm(blankDaily()); setActiveDay(null); setEditingWeekId(null);
      } else toast_("Error saving — check connection");
    } else {
      const row = { car_id: wForm.carId, user_id: userId, week_start: wForm.weekStart, week_end: wForm.weekEnd, km: totalKm, daily_km: dailyKmToStore, amount: Number(wForm.amount), paid: wForm.paid, notes: wForm.notes };
      const { data, error } = await supabase.from("weeks").insert(row).select().single();
      if (!error) { setWeeks(w => [data, ...w]); toast_(`✓ Week logged — ${totalKm.toFixed(0)} km`); setShowW(false); setWForm(blankDaily()); setActiveDay(null); }
      else toast_("Error saving — check connection");
    }
    setSyncing(false);
  }

  function startEditWeek(week) {
    setEditingWeekId(week.id);
    const hasDailyBreakdown = Array.isArray(week.daily_km) && week.daily_km.length === 7;
    setWForm({
      carId: week.car_id,
      weekStart: week.week_start,
      weekEnd: week.week_end || addDaysStr(week.week_start, 6),
      entryMode: hasDailyBreakdown ? "daily" : "total",
      totalKm: hasDailyBreakdown ? "" : String(week.km),
      days: hasDailyBreakdown ? week.daily_km.map(String) : Array(7).fill(""),
      amount: String(week.amount),
      paid: week.paid,
      notes: week.notes || "",
    });
    setShowW(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelWeekForm() {
    setShowW(false);
    setEditingWeekId(null);
    setWForm(blankDaily());
    setActiveDay(null);
  }

  async function handleSaveCost() {
    if (!cForm.carId || !cForm.date || !cForm.amount) return;
    setSyncing(true);
    if (editingCostId) {
      const updates = { car_id: cForm.carId, date: cForm.date, amount: Number(cForm.amount), category: cForm.category, notes: cForm.notes };
      const { data, error } = await supabase.from("costs").update(updates).eq("id", editingCostId).select().single();
      if (!error) {
        setCosts(c => c.map(x => x.id === editingCostId ? data : x));
        toast_("✓ Cost updated");
        setShowC(false); setCForm(blankCost); setEditingCostId(null);
      } else toast_("Error saving");
    } else {
      const row = { car_id: cForm.carId, user_id: userId, date: cForm.date, amount: Number(cForm.amount), category: cForm.category, notes: cForm.notes };
      const { data, error } = await supabase.from("costs").insert(row).select().single();
      if (!error) { setCosts(c => [data, ...c]); toast_("✓ Cost saved"); setShowC(false); setCForm(f => ({ ...f, amount: "", notes: "" })); }
      else toast_("Error saving");
    }
    setSyncing(false);
  }

  function startEditCost(cost) {
    setEditingCostId(cost.id);
    setCForm({ carId: cost.car_id, date: cost.date, amount: String(cost.amount), category: cost.category, notes: cost.notes || "" });
    setShowC(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelCostForm() {
    setShowC(false);
    setEditingCostId(null);
    setCForm(blankCost);
  }

  async function handleAddCar() {
    if (!newCar.name) return;
    setSyncing(true);
    const row = {
      user_id: userId, name: newCar.name, color: newCar.color,
      weekly_rate: Number(newCar.weeklyRate) || 130,
      odometer_baseline: Number(newCar.odometerBaseline) || 0,
      odometer_baseline_date: newCar.odometerDate || today(),
      alerts: DEFAULT_ALERTS(),
    };
    const { data, error } = await supabase.from("cars").insert(row).select().single();
    if (!error) {
      setCars(c => [...c, data]);
      toast_("✓ Car added");
      setShowAddCar(false);
      setNewCar({ name: "", color: C.cyan, weeklyRate: 130, odometerBaseline: "", odometerDate: today() });
    } else toast_("Error saving");
    setSyncing(false);
  }

  async function handleSaveOdometer(carId) {
    const reading = Number(odoForm.reading);
    if (isNaN(reading) || !odoForm.date) return;
    setSyncing(true);
    const { data, error } = await supabase.from("cars")
      .update({ odometer_baseline: reading, odometer_baseline_date: odoForm.date })
      .eq("id", carId).select().single();
    if (!error) {
      setCars(c => c.map(x => x.id === carId ? data : x));
      toast_("✓ Odometer updated");
      setEditingOdoCarId(null);
    } else toast_("Error saving");
    setSyncing(false);
  }

  async function handleSaveDoc() {
    if (!docForm.carId || !docForm.type || !docForm.expiry) return;
    setSyncing(true);
    let photoUrl = null;
    if (docForm.photoFile) {
      setUploadingPhoto(true);
      const ext = docForm.photoFile.name.split(".").pop() || "jpg";
      const path = `${userId}/${docForm.carId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("doc-photos").upload(path, docForm.photoFile);
      setUploadingPhoto(false);
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("doc-photos").getPublicUrl(path);
        photoUrl = urlData?.publicUrl || null;
      }
    }
    const row = { car_id: docForm.carId, user_id: userId, type: docForm.type, expiry: docForm.expiry, notes: docForm.notes, photo_url: photoUrl };
    const { data, error } = await supabase.from("docs").insert(row).select().single();
    if (!error) {
      setDocs(d => [...d, data].sort((a, b) => new Date(a.expiry) - new Date(b.expiry)));
      toast_("✓ Document saved");
      setShowDocForm(false);
      setDocForm(f => ({ ...f, expiry: "", notes: "", photoFile: null, photoPreview: null }));
    } else toast_("Error saving");
    setSyncing(false);
  }

  function startEditIncident(inc) {
    if (!inc) { setEditingIncidentId(null); return; }
    setEditingIncidentId(inc.id);
    setIncidentForm({
      carId: inc.car_id,
      date: inc.date,
      description: inc.description || "",
      repairShop: inc.repair_shop || "",
      status: inc.status || "Quoted",
      quotationAmount: inc.quotation_amount ? String(inc.quotation_amount) : "",
      repairAmount: inc.repair_amount ? String(inc.repair_amount) : "",
      notes: inc.notes || "",
      photoFiles: [], // can't re-edit uploaded photos, only add new ones
    });
  }

  async function handleSaveIncident() {
    if (!incidentForm.carId || !incidentForm.date || !incidentForm.description) {
      toast_("Add a date and description first"); return;
    }
    setSyncing(true);
    const photoUrls = [];
    if (incidentForm.photoFiles?.length) {
      setUploadingPhoto(true);
      for (const { file } of incidentForm.photoFiles) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${userId}/${incidentForm.carId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("incident-photos").upload(path, file);
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("incident-photos").getPublicUrl(path);
          if (urlData?.publicUrl) photoUrls.push(urlData.publicUrl);
        }
      }
      setUploadingPhoto(false);
    }

    if (editingIncidentId) {
      // Update — keep existing photos, append any new ones
      const existing = incidents.find(i => i.id === editingIncidentId);
      const existingPhotos = existing?.photo_urls || [];
      const allPhotos = [...existingPhotos, ...photoUrls];
      const updates = {
        car_id: incidentForm.carId, date: incidentForm.date,
        description: incidentForm.description, repair_shop: incidentForm.repairShop,
        status: incidentForm.status,
        quotation_amount: incidentForm.quotationAmount ? Number(incidentForm.quotationAmount) : null,
        repair_amount: incidentForm.repairAmount ? Number(incidentForm.repairAmount) : null,
        photo_urls: allPhotos.length ? allPhotos : null,
        notes: incidentForm.notes,
      };
      const { data, error } = await supabase.from("incidents").update(updates).eq("id", editingIncidentId).select().single();
      if (!error) {
        setIncidents(i => i.map(x => x.id === editingIncidentId ? data : x));
        toast_("✓ Incident updated");
        setEditingIncidentId(null);
        setIncidentForm({ carId: cars[0]?.id || "", date: today(), description: "", repairShop: "", status: "Quoted", quotationAmount: "", repairAmount: "", notes: "", photoFiles: [] });
      } else toast_("Error saving");
    } else {
      const row = {
        user_id: userId, car_id: incidentForm.carId, date: incidentForm.date,
        description: incidentForm.description, repair_shop: incidentForm.repairShop,
        status: incidentForm.status,
        quotation_amount: incidentForm.quotationAmount ? Number(incidentForm.quotationAmount) : null,
        repair_amount: incidentForm.repairAmount ? Number(incidentForm.repairAmount) : null,
        photo_urls: photoUrls.length ? photoUrls : null,
        notes: incidentForm.notes,
      };
      const { data, error } = await supabase.from("incidents").insert(row).select().single();
      if (!error) {
        setIncidents(i => [data, ...i]);
        toast_("✓ Incident logged");
        setShowIncidentForm(false);
        setIncidentForm({ carId: cars[0]?.id || "", date: today(), description: "", repairShop: "", status: "Quoted", quotationAmount: "", repairAmount: "", notes: "", photoFiles: [] });
      } else toast_("Error saving");
    }
    setSyncing(false);
  }

  async function updateIncidentStatus(id, status) {
    const { error } = await supabase.from("incidents").update({ status }).eq("id", id);
    if (!error) setIncidents(i => i.map(x => x.id === id ? { ...x, status } : x));
  }

  async function togglePaid(id, current) {
    const { error } = await supabase.from("weeks").update({ paid: !current }).eq("id", id);
    if (!error) setWeeks(w => w.map(x => x.id === id ? { ...x, paid: !current } : x));
  }

  async function markDone(carId, alertId) {
    const car = cars.find(c => c.id === carId);
    const km = currentOdometer(car, weeks);
    const newAlerts = (car.alerts || []).map(a => a.id === alertId ? { ...a, lastDoneKm: km } : a);
    const { error } = await supabase.from("cars").update({ alerts: newAlerts }).eq("id", carId);
    if (!error) { setCars(c => c.map(x => x.id === carId ? { ...x, alerts: newAlerts } : x)); toast_("✓ Marked done"); }
  }

  async function handleSaveServiceRecord(car) {
    if (!serviceForm.date || !serviceForm.odometerKm) { toast_("Add a date and odometer reading first"); return; }
    setSyncing(true);

    let photoUrl = null;
    if (serviceForm.photoFile) {
      setUploadingPhoto(true);
      const ext = serviceForm.photoFile.name.split(".").pop() || "jpg";
      const path = `${userId}/${car.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("service-photos").upload(path, serviceForm.photoFile);
      setUploadingPhoto(false);
      if (uploadError) {
        toast_("Photo upload failed — saving record without it");
      } else {
        const { data: urlData } = supabase.storage.from("service-photos").getPublicUrl(path);
        photoUrl = urlData?.publicUrl || null;
      }
    }

    const matchedAlert = (car.alerts || []).find(a => a.id === serviceForm.alertId);

    // Build notes from sticker fields so all the info is preserved
    const stickerDetails = [
      serviceForm.garage && `Garage: ${serviceForm.garage}`,
      serviceForm.serviceType && `Service type: ${serviceForm.serviceType}`,
      serviceForm.itemsDone?.length && `Done: ${serviceForm.itemsDone.join(", ")}`,
      serviceForm.nextServiceKm && `Next service due: ${Number(serviceForm.nextServiceKm).toLocaleString()} km`,
      serviceForm.notes,
    ].filter(Boolean).join(" · ");

    const row = {
      user_id: userId,
      car_id: car.id,
      alert_id: serviceForm.alertId || null,
      alert_label: matchedAlert ? matchedAlert.label : (serviceForm.serviceType ? `Type ${serviceForm.serviceType} Service` : "Service"),
      date: serviceForm.date,
      odometer_km: Number(serviceForm.odometerKm),
      photo_url: photoUrl,
      notes: stickerDetails || null,
    };

    const { data, error } = await supabase.from("service_records").insert(row).select().single();
    if (error) {
      toast_("Error saving service record");
      setSyncing(false);
      return;
    }
    setServiceRecords(r => [data, ...r]);

    // Auto-update the matching maintenance alert
    // If sticker has a "Next Service Due" km, use that to set the interval more accurately
    if (serviceForm.alertId) {
      const currentKm = Number(serviceForm.odometerKm);
      const nextKm = Number(serviceForm.nextServiceKm);
      const newAlerts = (car.alerts || []).map(a => {
        if (a.id !== serviceForm.alertId) return a;
        const updated = { ...a, lastDoneKm: currentKm };
        // If sticker gives next service km, recalculate the interval from it
        if (nextKm && nextKm > currentKm) {
          updated.intervalKm = nextKm - currentKm;
        }
        return updated;
      });
      const { error: alertError } = await supabase.from("cars").update({ alerts: newAlerts }).eq("id", car.id);
      if (!alertError) setCars(c => c.map(x => x.id === car.id ? { ...x, alerts: newAlerts } : x));
    }

    toast_("✓ Service record saved");
    setShowServiceForm(null);
    setServiceForm({ alertId: "", date: today(), odometerKm: "", nextServiceKm: "", itemsDone: [], serviceType: "A", garage: "", notes: "", photoFile: null, photoPreview: null });
    setSyncing(false);
  }

  async function deleteServiceRecord(id) {
    const record = serviceRecords.find(r => r.id === id);
    const { error } = await supabase.from("service_records").delete().eq("id", id);
    if (!error) {
      setServiceRecords(r => r.filter(x => x.id !== id));
      // Best-effort cleanup of the stored photo, ignore failures
      if (record?.photo_url) {
        try {
          const path = record.photo_url.split("/service-photos/")[1];
          if (path) await supabase.storage.from("service-photos").remove([path]);
        } catch { /* non-critical */ }
      }
      toast_("Record deleted");
    }
  }

  async function del(table, id, setter) {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (!error) setter(prev => prev.filter(x => x.id !== id));
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ color: C.cyan, fontSize: 40 }}>⚡</div>
        <div style={{ color: C.muted, fontSize: 13 }}>Loading your fleet...</div>
      </div>
    );
  }

  async function completeOnboarding(sector, displayName) {
    const updates = { id: userId, sector, display_name: displayName || null, onboarded: true };
    const { data } = await supabase.from("profiles").upsert(updates).select().single();
    if (data) setProfile(data);
  }

  // Show onboarding if profile doesn't exist or sector not set yet
  if (!profile || !profile.onboarded) {
    return <Onboarding onComplete={completeOnboarding} />;
  }

  const sector = profile.sector || "ridehailing";
  const cfg = getSectorCfg(sector);

  const nav = [
    { id: "dashboard", label: "Dashboard" },
    { id: "weekly", label: cfg.incomeTab },
    { id: "costs", label: "Costs" },
    { id: "maintenance", label: "Service" },
    { id: "docs", label: "Docs" },
    { id: "cars", label: cfg.vehiclesLabel },
  ];

  return (
    <div style={S.app}>
      {toast && <div style={{ position: "fixed", top: 14, right: 14, background: C.green, color: "#000", padding: "9px 18px", borderRadius: 8, fontWeight: 700, fontSize: 13, zIndex: 999, boxShadow: `0 4px 20px ${C.green}44` }}>{toast}</div>}
      {syncing && <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: C.cyan, zIndex: 1000 }} />}

      <header style={S.header}>
        <div style={S.logo}>⚡ FleetMate</div>
        <span style={{ fontSize: 10, color: C.muted, background: C.faint, borderRadius: 6, padding: "2px 7px", marginLeft: 2 }}>{cfg.icon} {cfg.label}</span>
        {(allAlerts.length + docAlerts.length) > 0 && (
          <span onClick={() => setView(allAlerts.length ? "maintenance" : "docs")} style={{ background: C.amber + "22", color: C.amber, borderRadius: 99, padding: "2px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            ⚠ {allAlerts.length + docAlerts.length}
          </span>
        )}
        <nav style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {nav.map(n => (
            <button key={n.id} onClick={() => setView(n.id)} style={{ background: view === n.id ? C.faint : "transparent", color: view === n.id ? C.text : C.muted, border: "none", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: view === n.id ? 600 : 400 }}>{n.label}</button>
          ))}
          <button onClick={signOut} style={{ background: "transparent", color: C.muted, border: "none", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>Sign out</button>
        </nav>
      </header>

      {view === "dashboard" && (
        <Dashboard cars={cars} weeks={weeks} costs={costs} allAlerts={allAlerts} docAlerts={docAlerts} paymentAlerts={paymentAlerts} missingWeekAlerts={missingWeekAlerts} carName={carName} setView={setView} sector={sector} />
      )}

      {view === "weekly" && (
        <Weekly
          weeks={weeks} cars={cars} filterCar={filterCar} setFilterCar={setFilterCar}
          carColor={carColor} carName={carName} togglePaid={togglePaid} del={del} setWeeks={setWeeks}
          showW={showW} setShowW={setShowW} wForm={wForm} setWForm={setWForm}
          editingWeekId={editingWeekId} setEditingWeekId={setEditingWeekId}
          activeDay={activeDay} setActiveDay={setActiveDay} syncing={syncing} blankDaily={blankDaily}
          onSaveWeek={handleSaveWeek} onCancelWeekForm={cancelWeekForm} onStartEditWeek={startEditWeek}
        />
      )}

      {view === "costs" && (
        <Costs
          costs={costs} cars={cars} filterCar={filterCar} setFilterCar={setFilterCar}
          carColor={carColor} carName={carName} del={del} setCosts={setCosts}
          showC={showC} setShowC={setShowC} cForm={cForm} setCForm={setCForm}
          editingCostId={editingCostId} setEditingCostId={setEditingCostId}
          syncing={syncing} blankCost={blankCost}
          onSaveCost={handleSaveCost} onCancelCostForm={cancelCostForm} onStartEditCost={startEditCost}
        />
      )}

      {view === "maintenance" && (
        <Maintenance
          cars={cars} weeks={weeks} markDone={markDone} serviceRecords={serviceRecords}
          showServiceForm={showServiceForm} setShowServiceForm={setShowServiceForm}
          serviceForm={serviceForm} setServiceForm={setServiceForm}
          syncing={syncing} uploadingPhoto={uploadingPhoto}
          onSaveServiceRecord={handleSaveServiceRecord} onDeleteServiceRecord={deleteServiceRecord}
        />
      )}

      {view === "docs" && (
        <Docs
          docs={docs} cars={cars} del={del} setDocs={setDocs}
          showForm={showDocForm} setShowForm={setShowDocForm}
          form={docForm} setForm={setDocForm} syncing={syncing} uploading={uploadingPhoto}
          onSaveDoc={handleSaveDoc}
          incidents={incidents} setIncidents={setIncidents}
          incidentForm={incidentForm} setIncidentForm={setIncidentForm}
          showIncidentForm={showIncidentForm} setShowIncidentForm={setShowIncidentForm}
          onSaveIncident={handleSaveIncident} updateIncidentStatus={updateIncidentStatus}
          onStartEditIncident={startEditIncident} editingIncidentId={editingIncidentId}
          carName={carName} carColor={carColor}
        />
      )}

      {view === "cars" && (
        <Cars
          cars={cars} weeks={weeks} carStats={carStats}
          showAddCar={showAddCar} setShowAddCar={setShowAddCar}
          newCar={newCar} setNewCar={setNewCar} syncing={syncing}
          onAddCar={handleAddCar}
          editingOdoCarId={editingOdoCarId} setEditingOdoCarId={setEditingOdoCarId}
          odoForm={odoForm} setOdoForm={setOdoForm} onSaveOdometer={handleSaveOdometer}
          cfg={cfg}
        />
      )}
    </div>
  );
}
