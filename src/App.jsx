import { useState, useEffect, useMemo } from "react";
import { supabase } from './supabase.js'

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID()
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtKm = (n) => `${Number(n || 0).toFixed(0)} km`;
const fmtRate = (n) => `$${Number(n || 0).toFixed(3)}/km`;
const today = () => new Date().toISOString().slice(0, 10);
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
function fmtWeekRange(mondayStr) {
  const mon = new Date(mondayStr);
  const sun = new Date(mondayStr);
  sun.setDate(sun.getDate() + 6);
  const opts = { day: "numeric", month: "short" };
  return `${mon.toLocaleDateString("en-GB", opts)} – ${sun.toLocaleDateString("en-GB", { ...opts, year: "numeric" })}`;
}
function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date(today())) / 86400000);
}
function docStatus(expiry) {
  const d = daysUntil(expiry);
  if (d < 0)   return { label: `Expired ${Math.abs(d)}d ago`, color: "#ef4444", level: "expired" };
  if (d <= 7)  return { label: `Expires in ${d}d — urgent!`, color: "#ef4444", level: "critical" };
  if (d <= 30) return { label: `Expires in ${d}d`, color: "#f59e0b", level: "soon" };
  return { label: `Valid · ${d}d left`, color: "#22c55e", level: "ok" };
}

const DOC_TYPES = ["Insurance (Full Cover)", "Insurance (Third Party)", "ZINARA / Vehicle Licence", "Roadworthy Certificate", "Other"];
const COST_CATS = ["Service & Insurance", "Tyres", "Repairs", "Accessories", "Safety", "Electronics", "Other"];

const DEFAULT_ALERTS = () => [
  { id: uid(), label: "Oil & Filter", intervalKm: 5000, lastDoneKm: 0 },
  { id: uid(), label: "Tyre Rotation", intervalKm: 10000, lastDoneKm: 0 },
  { id: uid(), label: "Full Service", intervalKm: 20000, lastDoneKm: 0 },
];

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#080c14", surface: "#0f1623", border: "#1a2236",
  text: "#e2e8f0", muted: "#64748b", faint: "#1e293b",
  green: "#22c55e", cyan: "#22d3ee", amber: "#f59e0b",
  red: "#ef4444", purple: "#a855f7",
};

const S = {
  app: { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter','Segoe UI',sans-serif", fontSize: 14 },
  header: { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 16px", display: "flex", alignItems: "center", gap: 10, height: 52, position: "sticky", top: 0, zIndex: 100 },
  logo: { color: C.cyan, fontWeight: 800, fontSize: 17, letterSpacing: "-0.04em" },
  page: { padding: "16px", maxWidth: 960, margin: "0 auto" },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  label: { color: C.muted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5, display: "block" },
  input: { background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "9px 12px", fontSize: 14, width: "100%", boxSizing: "border-box", outline: "none" },
  btn: (bg = C.cyan) => ({ background: bg, color: bg === C.cyan || bg === C.green ? "#000" : "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }),
  ghost: { background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  th: { color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" },
  td: { padding: "9px 10px", borderBottom: `1px solid ${C.faint}`, verticalAlign: "middle" },
  title: { fontSize: 18, fontWeight: 700, color: "#f8fafc", marginBottom: 4 },
  sub: { color: C.muted, fontSize: 13, marginBottom: 20 },
};

function Stat({ label, value, sub, color = C.cyan, small }) {
  return (
    <div style={{ background: C.faint, borderRadius: 10, padding: small ? "10px 14px" : "14px 18px", flex: 1, minWidth: 100 }}>
      <div style={{ color: C.muted, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: small ? 15 : 20, fontFamily: "monospace" }}>{value}</div>
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

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App({ session }) {
  const userId = session.user.id;

  const [cars, setCars]   = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [costs, setCosts] = useState([]);
  const [docs, setDocs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [view, setView] = useState("dashboard");
  const [filterCar, setFilterCar] = useState("all");
  const [toast, setToast] = useState("");
  const [activeDay, setActiveDay] = useState(null);

  const blankDaily = () => ({ carId: cars[0]?.id || "", weekStart: getMondayStr(), days: Array(7).fill(""), amount: "", paid: true, notes: "" });
  const blankCost = { carId: cars[0]?.id || "", date: today(), amount: "", category: "Service & Insurance", notes: "" };

  const [wForm, setWForm] = useState(blankDaily);
  const [editingWeekId, setEditingWeekId] = useState(null);
  const [cForm, setCForm] = useState(blankCost);
  const [editingCostId, setEditingCostId] = useState(null);
  const [showW, setShowW] = useState(false);
  const [showC, setShowC] = useState(false);
  const [showAddCar, setShowAddCar] = useState(false);
  const [newCar, setNewCar] = useState({ name: "", color: C.cyan, weeklyRate: 130 });

  function toast_(m) { setToast(m); setTimeout(() => setToast(""), 2500); }
  const carColor = (id) => cars.find(c => c.id === id)?.color || C.muted;
  const carName  = (id) => cars.find(c => c.id === id)?.name || "—";

  // ── Load all data ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const [carsRes, weeksRes, costsRes, docsRes] = await Promise.all([
        supabase.from("cars").select("*").eq("user_id", userId).order("created_at"),
        supabase.from("weeks").select("*").eq("user_id", userId).order("week_start", { ascending: false }),
        supabase.from("costs").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("docs").select("*").eq("user_id", userId).order("expiry"),
      ]);
      if (carsRes.data)  setCars(carsRes.data);
      if (weeksRes.data) setWeeks(weeksRes.data);
      if (costsRes.data) setCosts(costsRes.data);
      if (docsRes.data)  setDocs(docsRes.data);
      setLoading(false);
    }
    fetchAll();
  }, [userId]);

  useEffect(() => {
    if (cars.length && !wForm.carId) {
      setWForm(f => ({ ...f, carId: cars[0].id }));
      setCForm(f => ({ ...f, carId: cars[0].id }));
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
      const km = weeks.filter(w => w.car_id === car.id).reduce((s, w) => s + Number(w.km || 0), 0);
      (car.alerts || []).forEach(a => {
        const kmSince = km - a.lastDoneKm;
        const remaining = a.intervalKm - kmSince;
        const status = remaining <= 0 ? "due" : remaining <= a.intervalKm * 0.15 ? "soon" : "ok";
        if (status !== "ok") out.push({ car, alert: a, status, remaining, km });
      });
    });
    return out;
  }, [cars, weeks]);

  const docAlerts = useMemo(() =>
    docs.map(d => ({ ...d, ...docStatus(d.expiry) }))
        .filter(d => d.level !== "ok")
        .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
  , [docs]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function addWeek() {
    const totalKm = wForm.days.reduce((s, d) => s + (Number(d) || 0), 0);
    if (!wForm.carId || !wForm.weekStart || totalKm === 0 || !wForm.amount) return;
    setSyncing(true);

    if (editingWeekId) {
      // Update existing week
      const updates = { car_id: wForm.carId, week_start: wForm.weekStart, km: totalKm, daily_km: wForm.days, amount: Number(wForm.amount), paid: wForm.paid, notes: wForm.notes };
      const { data, error } = await supabase.from("weeks").update(updates).eq("id", editingWeekId).select().single();
      if (!error) {
        setWeeks(w => w.map(x => x.id === editingWeekId ? data : x));
        toast_(`✓ Week updated — ${totalKm.toFixed(0)} km`);
        setShowW(false); setWForm(blankDaily()); setActiveDay(null); setEditingWeekId(null);
      } else toast_("Error saving — check connection");
    } else {
      // Insert new week
      const row = { car_id: wForm.carId, user_id: userId, week_start: wForm.weekStart, km: totalKm, daily_km: wForm.days, amount: Number(wForm.amount), paid: wForm.paid, notes: wForm.notes };
      const { data, error } = await supabase.from("weeks").insert(row).select().single();
      if (!error) { setWeeks(w => [data, ...w]); toast_(`✓ Week logged — ${totalKm.toFixed(0)} km`); setShowW(false); setWForm(blankDaily()); setActiveDay(null); }
      else toast_("Error saving — check connection");
    }
    setSyncing(false);
  }

  function startEditWeek(week) {
    setEditingWeekId(week.id);
    setWForm({
      carId: week.car_id,
      weekStart: week.week_start,
      days: Array.isArray(week.daily_km) && week.daily_km.length === 7 ? week.daily_km.map(String) : [String(week.km), "", "", "", "", "", ""],
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

  async function addCost() {
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

  async function addCar() {
    if (!newCar.name) return;
    setSyncing(true);
    const row = { user_id: userId, name: newCar.name, color: newCar.color, weekly_rate: Number(newCar.weeklyRate) || 130, alerts: DEFAULT_ALERTS() };
    const { data, error } = await supabase.from("cars").insert(row).select().single();
    if (!error) { setCars(c => [...c, data]); toast_("✓ Car added"); setShowAddCar(false); setNewCar({ name: "", color: C.cyan, weeklyRate: 130 }); }
    else toast_("Error saving");
    setSyncing(false);
  }

  async function addDoc(form) {
    if (!form.carId || !form.type || !form.expiry) return false;
    setSyncing(true);
    const row = { car_id: form.carId, user_id: userId, type: form.type, expiry: form.expiry, notes: form.notes };
    const { data, error } = await supabase.from("docs").insert(row).select().single();
    if (!error) { setDocs(d => [...d, data].sort((a, b) => new Date(a.expiry) - new Date(b.expiry))); toast_("✓ Document saved"); setSyncing(false); return true; }
    toast_("Error saving"); setSyncing(false); return false;
  }

  async function togglePaid(id, current) {
    const { error } = await supabase.from("weeks").update({ paid: !current }).eq("id", id);
    if (!error) setWeeks(w => w.map(x => x.id === id ? { ...x, paid: !current } : x));
  }

  async function markDone(carId, alertId) {
    const km = weeks.filter(w => w.car_id === carId).reduce((s, w) => s + Number(w.km || 0), 0);
    const car = cars.find(c => c.id === carId);
    const newAlerts = (car.alerts || []).map(a => a.id === alertId ? { ...a, lastDoneKm: km } : a);
    const { error } = await supabase.from("cars").update({ alerts: newAlerts }).eq("id", carId);
    if (!error) { setCars(c => c.map(x => x.id === carId ? { ...x, alerts: newAlerts } : x)); toast_("✓ Marked done"); }
  }

  async function del(table, id, setter) {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (!error) setter(prev => prev.filter(x => x.id !== id));
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ color: C.cyan, fontSize: 40 }}>⚡</div>
        <div style={{ color: C.muted, fontSize: 13 }}>Loading your fleet...</div>
      </div>
    );
  }

  // ── Week form ─────────────────────────────────────────────────────────────
  function WeekForm() {
    const totalKm = wForm.days.reduce((s, d) => s + (Number(d) || 0), 0);
    const perKm = totalKm > 0 && wForm.amount > 0 ? Number(wForm.amount) / totalKm : 0;
    const [csvInfo, setCsvInfo] = useState(null); // { km, fuelCost, startDate, endDate, deviceName }
    const [csvError, setCsvError] = useState("");
    const [csvLoading, setCsvLoading] = useState(false);
    const [csvDateWarning, setCsvDateWarning] = useState("");

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

          // Strip BOM, normalize line endings, split into non-empty lines
          text = text.replace(/^\uFEFF/, "");
          const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
          if (lines.length < 2) throw new Error("File only has a header row, no data");

          // Some exports prefix every field with a tab character — strip leading tabs from each cell
          const parseLine = (line) => line.split(",").map(cell => cell.replace(/^\t+/, "").trim());

          const headers = parseLine(lines[0]);
          const values = parseLine(lines[1]);
          const row = {};
          headers.forEach((h, i) => { row[h] = values[i]; });

          // Find mileage column flexibly in case header text varies slightly
          const kmKey = Object.keys(row).find(k => /mileage/i.test(k));
          const costKey = Object.keys(row).find(k => /cost/i.test(k));
          const startKey = Object.keys(row).find(k => /start/i.test(k));
          const endKey = Object.keys(row).find(k => /end/i.test(k));
          const nameKey = Object.keys(row).find(k => /device/i.test(k));

          const km = kmKey ? parseFloat(row[kmKey]) : NaN;
          const fuelCost = costKey ? parseFloat(row[costKey]) : NaN;

          if (isNaN(km)) {
            throw new Error("Found the file but couldn't read a mileage number from it");
          }

          setCsvInfo({
            km,
            fuelCost,
            startDate: startKey ? row[startKey] : "",
            endDate: endKey ? row[endKey] : "",
            deviceName: nameKey ? row[nameKey] : "Vehicle",
          });

          // Pull the date (not time) portion out of "2026-06-01 00:00:00" style strings
          const rawStart = startKey ? row[startKey] : "";
          const rawEnd = endKey ? row[endKey] : "";
          const startDateOnly = rawStart ? rawStart.split(" ")[0] : "";
          const endDateOnly = rawEnd ? rawEnd.split(" ")[0] : "";

          let dateWarning = "";
          if (startDateOnly && endDateOnly) {
            const sd = new Date(startDateOnly);
            const ed = new Date(endDateOnly);
            const dayDiff = Math.round((ed - sd) / 86400000);
            const startDow = sd.getDay(); // 0 = Sunday, 1 = Monday

            if (startDow !== 1) {
              dateWarning = `Heads up: this range starts on a ${sd.toLocaleDateString("en-GB", { weekday: "long" })}, not a Monday.`;
            } else if (dayDiff !== 6) {
              dateWarning = `Heads up: this range covers ${dayDiff + 1} days, not a full 7-day week.`;
            }
          }
          setCsvDateWarning(dateWarning);

          // Use the CSV's start date as Week Starting if it's a valid date, so the dates always match the mileage
          setWForm(f => ({
            ...f,
            weekStart: startDateOnly && !isNaN(new Date(startDateOnly)) ? startDateOnly : f.weekStart,
            days: [String(km), "", "", "", "", "", ""],
          }));
        } catch (err) {
          setCsvError(err.message || "Couldn't read that file — make sure it's the SinoTrack mileage export CSV");
        }
      };

      reader.readAsText(file);
      // Reset the input value so selecting the same file twice still fires onChange
      e.target.value = "";
    }


    return (
      <div style={{ ...S.card, maxWidth: 560, marginBottom: 20, borderColor: C.cyan + "55" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: C.cyan, fontSize: 15 }}>{editingWeekId ? "Edit Week" : "Log This Week"}</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>{fmtWeekRange(wForm.weekStart)}</div>
        </div>

        {/* SinoTrack CSV import */}
        <div style={{ background: C.faint, borderRadius: 8, padding: "12px 14px", marginBottom: 16, border: `1px dashed ${C.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: csvInfo ? 10 : 0 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Import from SinoTrack</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Set Mon–Sun range on SinoTrack, download CSV, upload here</div>
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
                {csvInfo.startDate} → {csvInfo.endDate} · Week Starting date set automatically
              </div>
              {csvDateWarning && (
                <div style={{ fontSize: 10, color: C.amber, marginTop: 4, fontWeight: 600 }}>
                  ⚠ {csvDateWarning} Double-check the Week Starting field below before saving.
                </div>
              )}
              {!isNaN(csvInfo.fuelCost) && (
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                  SinoTrack estimates {fmt(csvInfo.fuelCost)} fuel cost for this range — this is a calculated
                  estimate, not a real receipt, so it's shown for reference only and not auto-filled into your costs.
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
            <label style={S.label}>Week Starting (Mon)</label>
            <input type="date" style={S.input} value={wForm.weekStart} onChange={e => setWForm(f => ({ ...f, weekStart: getMondayStr(e.target.value) }))} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Week Ending (Sun)</label>
            <input type="date" style={{ ...S.input, color: C.muted, cursor: "not-allowed" }} value={getSundayStr(wForm.weekStart)} readOnly />
          </div>
        </div>
        <label style={S.label}>Daily Mileage — tap each day as you read SinoTrack, or use the import above</label>
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
        <div style={{ background: C.faint, borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <span style={{ color: C.muted, fontSize: 12 }}>Week total</span>
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
          <button style={{ ...S.btn(), flex: 1 }} onClick={addWeek} disabled={syncing}>{syncing ? "Saving..." : editingWeekId ? "Update Week" : "Save Week"}</button>
          <button style={S.ghost} onClick={cancelWeekForm}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  function Dashboard() {
    const totKm  = carStats.reduce((s, c) => s + c.totalKm, 0);
    const totRec = carStats.reduce((s, c) => s + c.totalReceived, 0);
    const totCost= carStats.reduce((s, c) => s + c.totalCosts, 0);
    const totNet = totRec - totCost;
    return (
      <div style={S.page}>
        <div style={S.title}>Fleet Dashboard</div>
        <div style={S.sub}>{cars.length} cars · all-time</div>

        {(allAlerts.length > 0 || docAlerts.length > 0) && (
          <div style={{ ...S.card, borderColor: (allAlerts.some(a => a.status === "due") || docAlerts.some(d => d.level === "expired" || d.level === "critical")) ? C.red : C.amber, marginBottom: 16 }}>
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
          </div>
        )}

        <div style={{ ...S.row, marginBottom: 16 }}>
          <Stat label="Total Received" value={fmt(totRec)} color={C.green} />
          <Stat label="Total Costs" value={fmt(totCost)} color={C.red} />
          <Stat label="Net Profit" value={fmt(totNet)} color={totNet >= 0 ? C.green : C.red} />
          <Stat label="Fleet km" value={fmtKm(totKm)} color={C.cyan} />
        </div>

        <div style={{ ...S.row, marginBottom: 16 }}>
          {carStats.map(({ car, totalKm, totalReceived, totalCosts, net, perKm, avgWeeklyKm, unpaidCount, unpaidAmt }) => {
            const carKm = weeks.filter(w => w.car_id === car.id).reduce((s, w) => s + Number(w.km), 0);
            const maxPK = Math.max(...carStats.map(s => s.perKm), 0.001);
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
                  <div>Total: <strong style={{ color: C.cyan }}>{fmtKm(carKm)}</strong> · Avg/wk: <strong style={{ color: C.text }}>{fmtKm(avgWeeklyKm)}</strong></div>
                  {unpaidCount > 0 && <div style={{ color: C.red }}>{unpaidCount} unpaid week{unpaidCount > 1 ? "s" : ""} · {fmt(unpaidAmt)}</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={S.card}>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Weekly Mileage — Last 12 Weeks</div>
          <WeeklyBars weeks={weeks} cars={cars} />
        </div>
      </div>
    );
  }

  // ── Weekly log ────────────────────────────────────────────────────────────
  function Weekly() {
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
        {showW && <WeekForm />}
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
                    <td style={{ ...S.td, color: "#f8fafc", fontWeight: 600 }}>{fmtWeekRange(w.week_start)}</td>
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
                        <button onClick={() => startEditWeek(w)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13 }} title="Edit">✎</button>
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

  // ── Costs ─────────────────────────────────────────────────────────────────
  function Costs() {
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
              <button style={S.btn(C.red)} onClick={addCost} disabled={syncing}>{syncing ? "Saving..." : editingCostId ? "Update" : "Save"}</button>
              <button style={S.ghost} onClick={cancelCostForm}>Cancel</button>
            </div>
          </div>
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
                      <button onClick={() => startEditCost(c)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13 }} title="Edit">✎</button>
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

  // ── Maintenance ───────────────────────────────────────────────────────────
  function Maintenance() {
    return (
      <div style={S.page}>
        <div style={S.title}>Maintenance</div>
        <div style={S.sub}>Mileage-based service reminders</div>
        {cars.map(car => {
          const km = weeks.filter(w => w.car_id === car.id).reduce((s, w) => s + Number(w.km), 0);
          return (
            <div key={car.id} style={{ ...S.card, marginBottom: 16, borderTop: `3px solid ${car.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontWeight: 700, color: car.color, fontSize: 15 }}>{car.name}</span>
                <span style={{ fontSize: 12, color: C.muted }}>Tracked: <strong style={{ color: C.cyan }}>{fmtKm(km)}</strong></span>
              </div>
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
            </div>
          );
        })}
      </div>
    );
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  function Docs() {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ carId: cars[0]?.id || "", type: DOC_TYPES[0], expiry: "", notes: "" });
    const grouped = cars.map(car => ({ car, docs: docs.filter(d => d.car_id === car.id) }));
    return (
      <div style={S.page}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div><div style={S.title}>Documents</div><div style={S.sub}>Insurance, ZINARA, roadworthy</div></div>
          <button style={S.btn()} onClick={() => setShowForm(v => !v)}>+ Add</button>
        </div>
        {showForm && (
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
            <div style={S.row}>
              <button style={S.btn()} onClick={async () => { if (await addDoc(form)) { setShowForm(false); setForm(f => ({ ...f, expiry: "", notes: "" })); } }} disabled={syncing}>{syncing ? "Saving..." : "Save"}</button>
              <button style={S.ghost} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}
        {grouped.map(({ car, docs: cd }) => (
          <div key={car.id} style={{ ...S.card, marginBottom: 16, borderTop: `3px solid ${car.color}` }}>
            <div style={{ fontWeight: 700, color: car.color, fontSize: 15, marginBottom: 14 }}>{car.name}</div>
            {cd.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No documents yet.</div>}
            {cd.map(d => { const st = docStatus(d.expiry); return (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 8, marginBottom: 8, background: C.faint, borderLeft: `3px solid ${st.color}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{d.type}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Expires: {new Date(d.expiry).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{d.notes ? ` · ${d.notes}` : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.color + "18", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>{st.label}</span>
                  <button onClick={() => del("docs", d.id, setDocs)} style={{ background: "none", border: "none", color: C.border, cursor: "pointer" }}>✕</button>
                </div>
              </div>
            ); })}
          </div>
        ))}
      </div>
    );
  }

  // ── Cars ──────────────────────────────────────────────────────────────────
  function Cars() {
    return (
      <div style={S.page}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div><div style={S.title}>My Cars</div><div style={S.sub}>Manage your fleet</div></div>
          <button style={S.btn()} onClick={() => setShowAddCar(v => !v)}>+ Add Car</button>
        </div>
        {showAddCar && (
          <div style={{ ...S.card, maxWidth: 420, marginBottom: 16, borderColor: C.cyan + "44" }}>
            <div style={{ fontWeight: 700, color: C.cyan, marginBottom: 14 }}>New Car</div>
            <div style={{ marginBottom: 12 }}><label style={S.label}>Name</label>
              <input style={S.input} placeholder="e.g. Car 3 (Silver)" value={newCar.name} onChange={e => setNewCar(n => ({ ...n, name: e.target.value }))} />
            </div>
            <div style={{ ...S.row, marginBottom: 14 }}>
              <div style={{ flex: 1 }}><label style={S.label}>Weekly Rate ($)</label>
                <input type="number" style={S.input} value={newCar.weeklyRate} onChange={e => setNewCar(n => ({ ...n, weeklyRate: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}><label style={S.label}>Colour</label>
                <input type="color" value={newCar.color} onChange={e => setNewCar(n => ({ ...n, color: e.target.value }))} style={{ height: 40, width: "100%", borderRadius: 8, border: "none", cursor: "pointer" }} />
              </div>
            </div>
            <div style={S.row}>
              <button style={S.btn()} onClick={addCar} disabled={syncing}>{syncing ? "Saving..." : "Add Car"}</button>
              <button style={S.ghost} onClick={() => setShowAddCar(false)}>Cancel</button>
            </div>
          </div>
        )}
        {carStats.map(({ car, totalKm, totalReceived, totalCosts, net, perKm, avgWeeklyKm }) => (
          <div key={car.id} style={{ ...S.card, marginBottom: 14, borderLeft: `4px solid ${car.color}` }}>
            <div style={{ fontWeight: 700, color: car.color, fontSize: 15, marginBottom: 12 }}>{car.name}</div>
            <div style={S.row}>
              <Stat label="Received" value={fmt(totalReceived)} color={C.green} small />
              <Stat label="Costs" value={fmt(totalCosts)} color={C.red} small />
              <Stat label="Net" value={fmt(net)} color={net >= 0 ? C.green : C.red} small />
              <Stat label="Total km" value={fmtKm(totalKm)} color={C.cyan} small />
              <Stat label="$/km" value={fmtRate(perKm)} color={C.amber} small />
              <Stat label="Avg/wk" value={fmtKm(avgWeeklyKm)} color={C.muted} small />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const nav = [
    { id: "dashboard", label: "Dashboard" },
    { id: "weekly", label: "Weekly" },
    { id: "costs", label: "Costs" },
    { id: "maintenance", label: "Service" },
    { id: "docs", label: "Docs" },
    { id: "cars", label: "Cars" },
  ];

  return (
    <div style={S.app}>
      {toast && <div style={{ position: "fixed", top: 14, right: 14, background: C.green, color: "#000", padding: "9px 18px", borderRadius: 8, fontWeight: 700, fontSize: 13, zIndex: 999, boxShadow: `0 4px 20px ${C.green}44` }}>{toast}</div>}
      {syncing && <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: C.cyan, zIndex: 1000 }} />}

      <header style={S.header}>
        <div style={S.logo}>⚡ FleetLog</div>
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

      {view === "dashboard"   && <Dashboard />}
      {view === "weekly"      && <Weekly />}
      {view === "costs"       && <Costs />}
      {view === "maintenance" && <Maintenance />}
      {view === "docs"        && <Docs />}
      {view === "cars"        && <Cars />}
    </div>
  );
}
