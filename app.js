const DB_KEY = "hp_inventory_db_v1";
const SETTINGS_KEY = "hp_inventory_settings_v1";

const defaultDB = () => ({
  departments: [
    { id: 1, name: "Marketing" },
    { id: 2, name: "QA Testing" },
    { id: 3, name: "IT" },
    { id: 4, name: "Operasional" },
    { id: 5, name: "Servis" },
  ],
  users: [],
  devices: [],
  transactions: [],
  seq: { user: 1, device: 1, dept: 6, trx: 1 },
});

const defaultSettings = {
  passcodeHash: null,
  theme: "light",
  lastAutoBackup: null,
  fileMode: false,
  lastFileSave: null,
  lastSeenFileSave: null,
};

let db = null;
let settings = { ...defaultSettings };
let currentPage = "dashboard";
let fsState = { handle: null, mode: "browser", lastSave: null, name: "" };
let fsTimer = null;
let bannerAction = null;
let html5QrCode = null;
let coState = { user: null, devices: [] };
let ciState = { device: null, trx: null };
let mtState = { device: null, user: null };
const devSel = new Set();
const usrSel = new Set();

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));

function showMsg(container, text, kind = "info") {
  if (!container) return;
  const cls = kind === "error" ? "error" : kind === "warn" ? "warn" : "";
  container.innerHTML = `<div class="info-card ${cls}">${text}</div>`;
}

function clearMsg(container) {
  if (!container) return;
  container.innerHTML = "";
}

function toast(text, type = "") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.className = `toast ${type}`.trim();
  el.classList.remove("hidden");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), 3000);
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function fmtDur(fromIso, toIso = new Date()) {
  const ms = new Date(toIso) - new Date(fromIso);
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h} jam`;
  return `${Math.floor(h / 24)} hari ${h % 24} jam`;
}

function hashCode(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(36)}-${str.length}`;
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    db = raw ? JSON.parse(raw) : null;
  } catch {
    db = null;
  }

  if (!db || !db.departments || !db.users || !db.devices || !db.transactions || !db.seq) {
    db = defaultDB();
  }

  const sampleUsers = ["EMP-001", "EMP-002", "EMP-003"];
  const sampleNames = ["Budi Santoso", "Sari Wijaya", "Andi Pratama"];
  const sampleBarcodes = ["358912345678901", "358912345678902", "358912345678903"];
  const sampleBrands = ["Samsung", "Apple", "Xiaomi"];

  const pristine = db.transactions.length === 0 && db.users.length === 3 && db.devices.length === 3 && db.users.every((u, i) => u.user_code === sampleUsers[i] && u.name === sampleNames[i] && u.status === "active") && db.devices.every((d, i) => d.barcode === sampleBarcodes[i] && d.brand === sampleBrands[i]);

  if (pristine) {
    db = defaultDB();
  }

  if (!db.departments.some((d) => d.name.toLowerCase() === "servis")) {
    db.departments.push({ id: db.seq.dept++, name: "Servis" });
  }

  saveDB();
}

function saveDB() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  scheduleFileWrite();
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      settings = { ...defaultSettings, ...JSON.parse(raw) };
    }
  } catch {}
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function deptName(id) {
  return (db.departments.find((d) => d.id === id) || {}).name || "-";
}

function userName(id) {
  return (db.users.find((u) => u.id === id) || {}).name || "-";
}

function deviceById(id) {
  return db.devices.find((d) => d.id === id);
}

function activeTrxForDevice(deviceId) {
  return db.transactions.find((t) => t.device_id === deviceId && t.returned_at === null && t.status === "borrowed");
}

function openMaintTrxForDevice(deviceId) {
  return db.transactions.find((t) => t.type === "maintenance" && t.device_id === deviceId && !t.returned_at);
}

function nextTrxCode() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const countToday = db.transactions.filter((t) => (t.transaction_code || "").includes(`TRX-${dateKey}`)).length;
  return `TRX-${dateKey}-${String(countToday + 1).padStart(3, "0")}`;
}

function nextMaintCode() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const countToday = db.transactions.filter((t) => (t.transaction_code || "").includes(`MNT-${dateKey}`)).length;
  return `MNT-${dateKey}-${String(countToday + 1).padStart(3, "0")}`;
}

function trxIsOverdue(t) {
  return t.status === "borrowed" && t.expected_return_at && new Date(t.expected_return_at) < new Date();
}

function trxEffectiveStatus(t) {
  return trxIsOverdue(t) ? "overdue" : t.status;
}

const STATUS_LABEL = {
  available: "Tersedia",
  borrowed: "Dipinjam",
  maintenance: "Maintenance",
  lost: "Hilang",
  returned: "Kembali",
  overdue: "Terlambat",
  sent: "Di Servis",
  active: "Aktif",
  inactive: "Nonaktif",
};

function goto(page) {
  currentPage = page;
  $$(".page").forEach((p) => p.classList.add("hidden"));
  const target = $("#page-" + page);
  if (target) target.classList.remove("hidden");

  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === page));

  if (page === "dashboard") renderDashboard();
  if (page === "devices") renderDevices();
  if (page === "users") renderUsers();
  if (page === "reports") renderReports();
  if (page === "maintenance") renderMaintenance();
  if (page === "settings") {
    updatePwStatus();
    updateBkStatus();
    updateFsStatus();
  }
}

function openModal(title, bodyHtml) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  $("#modal-backdrop").classList.remove("hidden");
}

function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
}

$("#modal-backdrop").addEventListener("click", (e) => {
  if (e.target === $("#modal-backdrop")) closeModal();
});

function openScanner(onResult) {
  if (typeof Html5Qrcode === "undefined") {
    toast("Library kamera tidak termuat. Gunakan input manual atau scanner USB.", "error");
    return;
  }

  $("#scanner-backdrop").classList.remove("hidden");
  html5QrCode = new Html5Qrcode("scanner-region");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 260, height: 160 } },
    (text) => {
      closeScanner();
      onResult(text);
    },
    () => {}
  ).catch((err) => {
    closeScanner();
    toast("Gagal membuka kamera: " + err, "error");
  });
}

function closeScanner() {
  if (html5QrCode) {
    try { html5QrCode.stop().catch(() => {}); } catch {}
    html5QrCode = null;
  }
  $("#scanner-region").innerHTML = "";
  $("#scanner-backdrop").classList.add("hidden");
}

$("#scanner-close").addEventListener("click", closeScanner);

function getChartColor(name) {
  const root = getComputedStyle(document.documentElement);
  const map = {
    available: root.getPropertyValue("--success").trim(),
    borrowed: root.getPropertyValue("--warning").trim(),
    maintenance: root.getPropertyValue("--primary").trim(),
    lost: root.getPropertyValue("--danger").trim(),
  };
  return map[name] || root.getPropertyValue("--primary").trim();
}

function renderDashboard() {
  const counts = {
    total: db.devices.length,
    available: db.devices.filter((d) => d.status === "available").length,
    borrowed: db.devices.filter((d) => d.status === "borrowed").length,
    maintenance: db.devices.filter((d) => d.status === "maintenance").length,
    lost: db.devices.filter((d) => d.status === "lost").length,
  };

  const overdue = db.transactions.filter(trxIsOverdue).length;
  const openMaint = db.transactions.filter((t) => t.type === "maintenance" && !t.returned_at).length;

  $("#dash-cards").innerHTML = [
    ["blue", counts.total, "Total Unit"],
    ["green", counts.available, "Tersedia"],
    ["orange", counts.borrowed, "Dipinjam"],
    ["", counts.maintenance, "Maintenance"],
    ["", openMaint, "Servis Keluar"],
    ["red", counts.lost, "Hilang"],
    ["red", overdue, "Terlambat"],
  ].map(([c, n, label]) => `<div class="stat-card ${c}"><div class="num">${n}</div><div class="lbl">${label}</div></div>`).join("");

  const chartContext = $("#statusChart");
  if (chartContext && typeof Chart !== "undefined") {
    const labels = ["Tersedia", "Dipinjam", "Maintenance", "Hilang"];
    const values = [counts.available, counts.borrowed, counts.maintenance, counts.lost];
    const colors = [getChartColor("available"), getChartColor("borrowed"), getChartColor("maintenance"), getChartColor("lost")];

    if (window.__hpChart) {
      window.__hpChart.destroy();
    }

    window.__hpChart = new Chart(chartContext, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: getComputedStyle(document.documentElement).getPropertyValue("--text").trim(),
              usePointStyle: true,
              pointStyle: "circle",
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${context.parsed}`,
            },
          },
        },
      },
    });
  }

  const activity = [...db.transactions].sort((a, b) => new Date(b.borrowed_at || b.created_at || 0) - new Date(a.borrowed_at || a.created_at || 0)).slice(0, 6);
  $("#dash-activity").innerHTML = activity.length ? activity.map((t) => {
    const device = deviceById(t.device_id) || {};
    const user = db.users.find((u) => u.id === t.user_id) || {};
    let title = "";
    let meta = "";

    if (t.type === "maintenance") {
      title = `${user.name || "Servis"} mengirim ${device.brand || "unit"} untuk servis`;
      meta = `${fmtDate(t.borrowed_at)} • ${t.destination || "Vendor"}`;
    } else {
      title = `${user.name || "Peminjam"} meminjam ${device.brand || "unit"} ${device.model || ""}`;
      meta = `${fmtDate(t.borrowed_at)} • ${t.transaction_code}`;
    }

    return `<div class="activity-item"><div class="activity-dot"></div><div class="activity-body"><div class="activity-title">${esc(title)}</div><div class="activity-meta">${esc(meta)}</div></div></div>`;
  }).join("") : `<div class="activity-item"><div class="activity-dot"></div><div class="activity-body"><div class="activity-title">Belum ada aktivitas</div><div class="activity-meta">Mulai catat transaksi untuk melihat log di sini.</div></div></div>`;

  const borrowed = db.transactions.filter((t) => t.status === "borrowed" && !t.returned_at).sort((a, b) => new Date(b.borrowed_at) - new Date(a.borrowed_at));
  $("#dash-borrowed").innerHTML = borrowed.length ? `
    <thead><tr><th>Kode</th><th>Unit</th><th>Peminjam</th><th>Divisi</th><th>Pinjam</th><th>Estimasi</th><th>Status</th></tr></thead><tbody>
      ${borrowed.map((t) => {
        const d = deviceById(t.device_id) || {};
        const status = trxEffectiveStatus(t);
        const user = db.users.find((u) => u.id === t.user_id) || {};
        return `<tr><td><span class="code">${esc(t.transaction_code)}</span></td><td>${esc(d.brand || "")} ${esc(d.model || "")}<br><small>${esc(d.barcode || "")}</small></td><td>${esc(user.name || "-")}</td><td>${esc(deptName(user.department_id))}</td><td>${fmtDate(t.borrowed_at)}</td><td>${fmtDate(t.expected_return_at)}</td><td><span class="badge ${status}">${STATUS_LABEL[status]}</span></td></tr>`;
      }).join("")}
    </tbody>
  ` : `<tbody><tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px;">Tidak ada unit yang sedang dipinjam</td></tr></tbody>`;

  const recent = [...db.transactions].sort((a, b) => new Date(b.borrowed_at) - new Date(a.borrowed_at)).slice(0, 8);
  $("#dash-recent").innerHTML = recent.length ? `
    <thead><tr><th>Kode</th><th>Unit</th><th>Peminjam</th><th>Keluar</th><th>Kembali</th><th>Status</th></tr></thead><tbody>
      ${recent.map((t) => {
        const d = deviceById(t.device_id) || {};
        const user = db.users.find((u) => u.id === t.user_id) || {};
        const status = trxEffectiveStatus(t);
        return `<tr><td><span class="code">${esc(t.transaction_code)}</span></td><td>${esc(d.brand || "")} ${esc(d.model || "")}</td><td>${esc(user.name || "-")}</td><td>${fmtDate(t.borrowed_at)}</td><td>${fmtDate(t.returned_at)}</td><td><span class="badge ${status}">${STATUS_LABEL[status]}</span></td></tr>`;
      }).join("")}
    </tbody>
  ` : `<tbody><tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px;">Belum ada transaksi</td></tr></tbody>`;
}

function coRenderUser() {
  if (!coState.user) {
    clearMsg($("#co-user-info"));
    return;
  }
  const u = coState.user;
  $("#co-user-info").innerHTML = `<div class="info-card">👤 <b>${esc(u.name)}</b> (${esc(u.user_code)})<br>Divisi: ${esc(deptName(u.department_id))} · ${esc(u.phone_number || "-")}</div>`;
}

function coRenderDevices() {
  if (!coState.devices.length) {
    $("#co-device-list").innerHTML = "";
    return;
  }

  $("#co-device-list").innerHTML = `<div class="pick-list">${coState.devices.map((d, i) => `
    <div class="pick-item">
      <div class="pick-info">📱 <b>${esc(d.brand)} ${esc(d.model)}</b> · ${esc(d.barcode)}</div>
      <button class="btn small danger" data-remove-idx="${i}">✕ Hapus</button>
    </div>
  `).join("")}</div>`;

  $$("[data-remove-idx]").forEach((el) => {
    el.addEventListener("click", () => {
      coState.devices.splice(Number(el.dataset.removeIdx), 1);
      coRenderDevices();
      coUpdateSave();
    });
  });
}

function coUpdateSave() {
  $("#co-save").disabled = !(coState.user && coState.devices.length);
}

function coReset() {
  coState = { user: null, devices: [] };
  $("#co-user-input").value = "";
  $("#co-device-input").value = "";
  $("#co-expected").value = "";
  $("#co-condition").value = "Kondisi Baik";
  coRenderUser();
  coRenderDevices();
  coUpdateSave();
  clearMsg($("#co-msg"));
}

function coHandleUserCode(code) {
  const value = code.trim();
  if (!value) return;
  const u = db.users.find((x) => x.user_code.toLowerCase() === value.toLowerCase());
  if (!u) {
    showMsg($("#co-user-info"), `❌ Kode peminjam "<b>${esc(value)}</b>" tidak ditemukan.`, "error");
    return;
  }
  if (u.status !== "active") {
    showMsg($("#co-user-info"), `⚠️ <b>${esc(u.name)}</b> berstatus nonaktif.`, "warn");
    return;
  }
  coState.user = u;
  clearMsg($("#co-msg"));
  coRenderUser();
  coUpdateSave();
  $("#co-device-input").focus();
  toast(`Peminjam: ${u.name}`, "success");
}

function coHandleDeviceCode(code) {
  const value = code.trim();
  if (!value) return;
  const d = db.devices.find((x) => x.barcode.toLowerCase() === value.toLowerCase() || (x.imei || "").toLowerCase() === value.toLowerCase());
  if (!d) {
    showMsg($("#co-msg"), `❌ Unit "<b>${esc(value)}</b>" tidak terdaftar.`, "error");
    return;
  }
  if (d.status !== "available") {
    if (d.status === "borrowed") {
      const t = activeTrxForDevice(d.id);
      showMsg($("#co-msg"), `❌ <b>${esc(d.brand)} ${esc(d.model)}</b> sedang dipinjam oleh <b>${esc(userName(t ? t.user_id : 0))}</b>.`, "error");
      return;
    }
    showMsg($("#co-msg"), `❌ <b>${esc(d.brand)} ${esc(d.model)}</b> berstatus <b>${STATUS_LABEL[d.status]}</b>.`, "error");
    return;
  }
  if (coState.devices.some((x) => x.id === d.id)) {
    showMsg($("#co-msg"), `⚠️ Unit <b>${esc(d.brand)} ${esc(d.model)}</b> sudah ada di daftar.`, "warn");
    return;
  }

  coState.devices.push(d);
  clearMsg($("#co-msg"));
  coRenderDevices();
  coUpdateSave();
  $("#co-device-input").value = "";
  $("#co-device-input").focus();
  toast(`Ditambahkan: ${d.brand} ${d.model}`, "success");
}

function coSave() {
  if (!coState.user || !coState.devices.length) return;

  const expected = $("#co-expected").value ? new Date($("#co-expected").value).toISOString() : null;
  const condition = $("#co-condition").value.trim() || "Kondisi Baik";

  for (const d of coState.devices) {
    db.transactions.push({
      id: db.seq.trx++,
      transaction_code: nextTrxCode(),
      device_id: d.id,
      user_id: coState.user.id,
      borrowed_at: new Date().toISOString(),
      expected_return_at: expected,
      returned_at: null,
      initial_condition: condition,
      return_condition: null,
      status: "borrowed",
      type: "borrow",
    });
    d.status = "borrowed";
  }

  saveDB();
  toast(`✅ ${coState.devices.length} unit berhasil dicatat keluar atas nama ${coState.user.name}`, "success");
  coReset();
}

$("#co-user-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    coHandleUserCode(e.target.value);
    e.target.value = "";
  }
});

$("#co-device-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    coHandleDeviceCode(e.target.value);
    e.target.value = "";
  }
});

$("#co-save").addEventListener("click", coSave);
$("#co-reset").addEventListener("click", coReset);

function ciReset() {
  ciState = { device: null, trx: null };
  $("#ci-device-input").value = "";
  $("#ci-note").value = "";
  $("#ci-condition").value = "Baik";
  $("#ci-maintenance").checked = false;
  $("#ci-form").classList.add("hidden");
  clearMsg($("#ci-info"));
  clearMsg($("#ci-msg"));
  $("#ci-device-input").focus();
}

function ciHandleDeviceCode(code) {
  const value = code.trim();
  if (!value) return;
  const d = db.devices.find((x) => x.barcode.toLowerCase() === value.toLowerCase() || (x.imei || "").toLowerCase() === value.toLowerCase());
  if (!d) {
    showMsg($("#ci-info"), `❌ Unit "<b>${esc(value)}</b>" tidak ditemukan.`, "error");
    return;
  }
  if (d.status !== "borrowed") {
    showMsg($("#ci-info"), `⚠️ <b>${esc(d.brand)} ${esc(d.model)}</b> berstatus <b>${STATUS_LABEL[d.status]}</b>.`, "warn");
    return;
  }

  const t = activeTrxForDevice(d.id);
  if (!t) {
    showMsg($("#ci-info"), `⚠️ Tidak ada transaksi aktif untuk unit ini.`, "warn");
    return;
  }

  const u = db.users.find((x) => x.id === t.user_id) || {};
  const overdue = trxIsOverdue(t);
  ciState = { device: d, trx: t };
  $("#ci-info").innerHTML = `<div class="info-card ${overdue ? "warn" : ""}">📱 <b>${esc(d.brand)} ${esc(d.model)}</b> · ${esc(d.barcode)}<br>👤 Dipinjam oleh <b>${esc(u.name || "-")}</b> (${esc(u.user_code || "")}) · Divisi ${esc(deptName(u.department_id))}<br>🕐 Keluar: ${fmtDate(t.borrowed_at)} · ${fmtDur(t.borrowed_at)}<br>📅 Est. kembali: ${fmtDate(t.expected_return_at)} ${overdue ? '<span class="badge overdue">TERLAMBAT</span>' : ""}<br>Kondisi awal: ${esc(t.initial_condition || "-")}</div>`;
  $("#ci-form").classList.remove("hidden");
}

function ciSave() {
  const { device, trx } = ciState;
  if (!device || !trx) return;
  const note = $("#ci-note").value.trim();
  const cond = $("#ci-condition").value + (note ? ` — ${note}` : "");

  trx.returned_at = new Date().toISOString();
  trx.return_condition = cond;
  trx.status = "returned";
  device.status = $("#ci-maintenance").checked ? "maintenance" : "available";
  saveDB();
  toast(`✅ ${device.brand} ${device.model} berhasil dikembalikan`, "success");
  ciReset();
}

$("#ci-device-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    ciHandleDeviceCode(e.target.value);
    e.target.value = "";
  }
});
$("#ci-save").addEventListener("click", ciSave);
$("#ci-cancel").addEventListener("click", ciReset);

function mtHandleUser(code) {
  const value = code.trim();
  if (!value) return;
  const u = db.users.find((x) => x.user_code.toLowerCase() === value.toLowerCase());
  if (!u) {
    showMsg($("#mt-user-info"), `❌ Kode kartu "<b>${esc(value)}</b>" tidak ditemukan.`, "error");
    return;
  }
  if (u.status !== "active") {
    showMsg($("#mt-user-info"), `⚠️ <b>${esc(u.name)}</b> berstatus nonaktif.`, "warn");
    return;
  }
  if (deptName(u.department_id).trim().toLowerCase() !== "servis") {
    showMsg($("#mt-user-info"), `⚠️ <b>${esc(u.name)}</b> dari Divisi ${esc(deptName(u.department_id))}. Unit servis hanya bisa dipinjam oleh Divisi Servis.`, "error");
    return;
  }
  mtState.user = u;
  $("#mt-user-info").innerHTML = `<div class="info-card">👤 <b>${esc(u.name)}</b> (${esc(u.user_code)}) · Divisi ${esc(deptName(u.department_id))}</div>`;
  $("#mt-device-input").focus();
}

function mtHandleDevice(code) {
  const value = code.trim();
  if (!value) return;
  const d = db.devices.find((x) => x.barcode.toLowerCase() === value.toLowerCase() || (x.imei || "").toLowerCase() === value.toLowerCase());
  if (!d) {
    showMsg($("#mt-info"), `❌ Unit "<b>${esc(value)}</b>" tidak ditemukan.`, "error");
    return;
  }
  if (d.status !== "maintenance") {
    showMsg($("#mt-info"), `⚠️ <b>${esc(d.brand)} ${esc(d.model)}</b> berstatus <b>${STATUS_LABEL[d.status]}</b>.`, "warn");
    return;
  }
  if (openMaintTrxForDevice(d.id)) {
    showMsg($("#mt-info"), `⚠️ <b>${esc(d.brand)} ${esc(d.model)}</b> sudah sedang di luar untuk servis.`, "warn");
    return;
  }

  mtState.device = d;
  $("#mt-info").innerHTML = `<div class="info-card warn">🔧 <b>${esc(d.brand)} ${esc(d.model)}</b> · ${esc(d.barcode)}<br>IMEI: ${esc(d.imei || "-")} · Serial: ${esc(d.serial_number || "-")}</div>`;
  $("#mt-dest").focus();
}

function mtReset() {
  mtState = { device: null, user: null };
  $("#mt-device-input").value = "";
  $("#mt-user-input").value = "";
  $("#mt-dest").value = "";
  $("#mt-note").value = "";
  clearMsg($("#mt-info"));
  clearMsg($("#mt-user-info"));
  $("#mt-device-input").focus();
}

function mtSave() {
  const d = mtState.device;
  if (!d) return toast("Scan barcode unit maintenance dulu", "error");
  if (!mtState.user) return toast("Scan kartu peminjam Divisi Servis dulu", "error");

  const dest = $("#mt-dest").value.trim();
  if (!dest) return toast("Tujuan / vendor servis wajib diisi", "error");

  db.transactions.push({
    id: db.seq.trx++,
    type: "maintenance",
    transaction_code: nextMaintCode(),
    device_id: d.id,
    user_id: mtState.user.id,
    borrowed_at: new Date().toISOString(),
    expected_return_at: null,
    returned_at: null,
    initial_condition: $("#mt-note").value.trim() || "-",
    return_condition: null,
    status: "sent",
    destination: dest,
  });

  saveDB();
  toast(`✅ ${d.brand} ${d.model} keluar untuk servis`, "success");
  mtReset();
  renderMaintenance();
}

function mtReturn(trxId) {
  const t = db.transactions.find((x) => x.id === trxId);
  if (!t) return;
  const d = deviceById(t.device_id) || {};

  openModal("Konfirmasi Kembali dari Servis", `
    <p class="muted">📱 <b>${esc(d.brand || "")}</b> ${esc(d.model || "")} · ${esc(d.barcode || "")}<br>🏭 Tujuan: ${esc(t.destination || "-")} · 👤 ${esc(userName(t.user_id))}<br>🕐 Dikirim: ${fmtDate(t.borrowed_at)}</p>
    <div class="form-block">
      <label>
        Status unit setelah kembali
        <select id="mr-status">
          <option value="available">Tersedia</option>
          <option value="maintenance">Maintenance</option>
          <option value="lost">Hilang</option>
        </select>
      </label>
      <label>
        Catatan hasil servis
        <input id="mr-note" type="text" placeholder="mis. LCD diganti, fungsi normal" />
      </label>
    </div>
    <div class="actions">
      <button id="mr-save" class="btn primary">✅ Simpan</button>
      <button id="mr-cancel" class="btn ghost">Batal</button>
    </div>
  `);

  $("#mr-cancel").addEventListener("click", closeModal);
  $("#mr-save").addEventListener("click", () => {
    t.returned_at = new Date().toISOString();
    t.return_condition = $("#mr-note").value.trim() || "-";
    t.status = "returned";
    d.status = $("#mr-status").value;
    saveDB();
    closeModal();
    renderMaintenance();
    toast(`Unit kembali dari servis → ${STATUS_LABEL[d.status]}`, "success");
  });
}

function renderMaintenance() {
  const out = db.transactions.filter((t) => t.type === "maintenance" && !t.returned_at).sort((a, b) => new Date(b.borrowed_at) - new Date(a.borrowed_at));
  $("#mt-out-table").innerHTML = `
    <thead><tr><th>Kode</th><th>Unit</th><th>Barcode</th><th>Tujuan</th><th>Pemegang Kartu</th><th>Dikirim</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody>
      ${out.length ? out.map((t) => {
        const d = deviceById(t.device_id) || {};
        return `<tr><td><span class="code">${esc(t.transaction_code)}</span></td><td>${esc(d.brand || "")} ${esc(d.model || "")}</td><td><span class="code">${esc(d.barcode || "")}</span></td><td>${esc(t.destination || "-")}</td><td>${esc(userName(t.user_id))}</td><td>${fmtDate(t.borrowed_at)}</td><td>${esc(t.initial_condition || "-")}</td><td><button class="btn small primary" data-mt-return="${t.id}">📥 Kembali</button></td></tr>`;
      }).join("") : `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px;">Tidak ada unit yang sedang di luar</td></tr>`}
    </tbody>
  `;
  $$("[data-mt-return]").forEach((btn) => btn.addEventListener("click", () => mtReturn(Number(btn.dataset.mtReturn))));

  const hist = db.transactions.filter((t) => t.type === "maintenance" && t.returned_at).sort((a, b) => new Date(b.returned_at) - new Date(a.returned_at)).slice(0, 15);
  $("#mt-history-table").innerHTML = `
    <thead><tr><th>Kode</th><th>Unit</th><th>Tujuan</th><th>Pemegang</th><th>Dikirim</th><th>Kembali</th><th>Status</th><th>Hasil</th></tr></thead><tbody>
      ${hist.length ? hist.map((t) => {
        const d = deviceById(t.device_id) || {};
        return `<tr><td><span class="code">${esc(t.transaction_code)}</span></td><td>${esc(d.brand || "")} ${esc(d.model || "")}</td><td>${esc(t.destination || "-")}</td><td>${esc(userName(t.user_id))}</td><td>${fmtDate(t.borrowed_at)}</td><td>${fmtDate(t.returned_at)}</td><td><span class="badge ${d.status || "available"}">${STATUS_LABEL[d.status || "available"]}</span></td><td>${esc(t.return_condition || "-")}</td></tr>`;
      }).join("") : `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px;">Belum ada riwayat</td></tr>`}
    </tbody>
  `;
}

$("#mt-user-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    mtHandleUser(e.target.value);
    e.target.value = "";
  }
});

$("#mt-device-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    mtHandleDevice(e.target.value);
    e.target.value = "";
  }
});

$("#mt-save").addEventListener("click", mtSave);
$("#mt-cancel").addEventListener("click", mtReset);

function updateSelButtons() {
  $("#dev-print-sel").textContent = `🖨 Cetak Label (${devSel.size})`;
  $("#usr-print-sel").textContent = `🖨 Cetak Label (${usrSel.size})`;
}

function renderDevices() {
  const query = $("#dev-search").value.toLowerCase();
  const filter = $("#dev-filter").value;
  const rows = db.devices.filter((d) => (!filter || d.status === filter) && (!query || [d.barcode, d.brand, d.model, d.imei, d.serial_number].some((v) => (v || "").toLowerCase().includes(query))));

  $("#dev-table").innerHTML = `
    <thead><tr><th style="width:34px"><input type="checkbox" id="dev-sel-all" title="Pilih semua" /></th><th>Barcode</th><th>Merek</th><th>Model</th><th>IMEI</th><th>Serial</th><th>Status</th><th>Peminjam</th><th>Aksi</th></tr></thead><tbody>
      ${rows.length ? rows.map((d) => {
        const t = activeTrxForDevice(d.id);
        return `<tr><td><input type="checkbox" data-sel-dev="${d.id}" ${devSel.has(d.id) ? "checked" : ""} /></td><td><span class="code">${esc(d.barcode)}</span></td><td>${esc(d.brand)}</td><td>${esc(d.model)}</td><td>${esc(d.imei || "-")}</td><td>${esc(d.serial_number || "-")}</td><td><span class="badge ${d.status}">${STATUS_LABEL[d.status]}</span></td><td>${t ? esc(userName(t.user_id)) : "-"}</td><td><button class="btn small" data-qr-dev="${d.id}">🏷 QR</button> <button class="btn small" data-edit-dev="${d.id}">✏️</button> <button class="btn small danger" data-del-dev="${d.id}">🗑</button></td></tr>`;
      }).join("") : `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:18px;">Tidak ada data</td></tr>`}
    </tbody>
  `;

  $("#dev-sel-all").addEventListener("change", (e) => {
    rows.forEach((d) => e.target.checked ? devSel.add(d.id) : devSel.delete(d.id));
    renderDevices();
  });

  $$("[data-sel-dev]").forEach((cb) => cb.addEventListener("change", () => {
    const id = Number(cb.dataset.selDev);
    cb.checked ? devSel.add(id) : devSel.delete(id);
    updateSelButtons();
  }));

  $$("[data-edit-dev]").forEach((b) => b.addEventListener("click", () => deviceForm(Number(b.dataset.editDev))));
  $$("[data-del-dev]").forEach((b) => b.addEventListener("click", () => deleteDevice(Number(b.dataset.delDev))));
  $$("[data-qr-dev]").forEach((b) => b.addEventListener("click", () => showQR("device", Number(b.dataset.qrDev))));

  updateSelButtons();
}

$("#dev-search").addEventListener("input", renderDevices);
$("#dev-filter").addEventListener("change", renderDevices);

function deviceForm(id) {
  const d = id ? deviceById(id) : null;
  openModal(d ? "Edit Unit HP" : "Tambah Unit HP", `
    <div class="form-block">
      <label>Barcode / IMEI<input id="f-barcode" type="text" value="${esc(d ? d.barcode : "")}" /></label>
      <label>Merek<input id="f-brand" type="text" value="${esc(d ? d.brand : "")}" /></label>
      <label>Model / Tipe<input id="f-model" type="text" value="${esc(d ? d.model : "")}" /></label>
      <label>IMEI<input id="f-imei" type="text" value="${esc(d ? d.imei || "" : "")}" /></label>
      <label>Serial Number<input id="f-sn" type="text" value="${esc(d ? d.serial_number || "" : "")}" /></label>
      <label>Status
        <select id="f-status">
          ${["available", "borrowed", "maintenance", "lost"].map((s) => `<option value="${s}" ${d && d.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="actions">
      <button id="f-save" class="btn primary">💾 Simpan</button>
      <button id="f-cancel" class="btn ghost">Batal</button>
    </div>
  `);

  $("#f-cancel").addEventListener("click", closeModal);
  $("#f-save").addEventListener("click", () => {
    const barcode = $("#f-barcode").value.trim();
    const brand = $("#f-brand").value.trim();
    const model = $("#f-model").value.trim();
    if (!barcode || !brand || !model) return toast("Barcode, Merek, dan Model wajib diisi", "error");

    const dup = db.devices.find((x) => x.barcode.toLowerCase() === barcode.toLowerCase() && (!d || x.id !== d.id));
    if (dup) return toast(`Barcode sudah dipakai unit lain: ${dup.brand} ${dup.model}`, "error");

    const status = $("#f-status").value;
    if (d) {
      const active = activeTrxForDevice(d.id);
      if (active && status !== "borrowed") return toast("Unit sedang dipinjam, status tidak bisa diubah manual", "error");
      Object.assign(d, { barcode, brand, model, imei: $("#f-imei").value.trim(), serial_number: $("#f-sn").value.trim(), status });
    } else {
      db.devices.push({ id: db.seq.device++, barcode, brand, model, imei: $("#f-imei").value.trim() || barcode, serial_number: $("#f-sn").value.trim(), status, created_at: new Date().toISOString() });
    }

    saveDB();
    closeModal();
    renderDevices();
    toast(d ? "Unit diperbarui" : "Unit ditambahkan", "success");
  });
}

$("#dev-add").addEventListener("click", () => deviceForm(null));

function deleteDevice(id) {
  const d = deviceById(id);
  if (!d) return;
  if (d.status === "borrowed" || activeTrxForDevice(id) || openMaintTrxForDevice(id)) return toast("Tidak bisa hapus unit yang sedang dipinjam / di luar servis", "error");
  if (!confirm(`Hapus unit ${d.brand} ${d.model} (${d.barcode})?`)) return;
  db.devices = db.devices.filter((x) => x.id !== id);
  saveDB();
  renderDevices();
  toast("Unit dihapus", "success");
}

function renderUsers() {
  const query = $("#usr-search").value.toLowerCase();
  const rows = db.users.filter((u) => !query || [u.user_code, u.name, u.phone_number, deptName(u.department_id)].some((v) => (v || "").toLowerCase().includes(query)));

  $("#usr-table").innerHTML = `
    <thead><tr><th style="width:34px"><input type="checkbox" id="usr-sel-all" /></th><th>Kode</th><th>Nama</th><th>Divisi</th><th>No. HP</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
      ${rows.length ? rows.map((u) => `
        <tr><td><input type="checkbox" data-sel-usr="${u.id}" ${usrSel.has(u.id) ? "checked" : ""} /></td><td><span class="code">${esc(u.user_code)}</span></td><td>${esc(u.name)}</td><td>${esc(deptName(u.department_id))}</td><td>${esc(u.phone_number || "-")}</td><td><span class="badge ${u.status}">${STATUS_LABEL[u.status]}</span></td><td><button class="btn small" data-qr-usr="${u.id}">🏷 QR</button> <button class="btn small" data-edit-usr="${u.id}">✏️</button> <button class="btn small danger" data-del-usr="${u.id}">🗑</button></td></tr>
      `).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px;">Tidak ada data</td></tr>`}
    </tbody>
  `;

  $("#usr-sel-all").addEventListener("change", (e) => {
    rows.forEach((u) => e.target.checked ? usrSel.add(u.id) : usrSel.delete(u.id));
    renderUsers();
  });

  $$("[data-sel-usr]").forEach((cb) => cb.addEventListener("change", () => {
    const id = Number(cb.dataset.selUsr);
    cb.checked ? usrSel.add(id) : usrSel.delete(id);
    updateSelButtons();
  }));

  $$("[data-edit-usr]").forEach((b) => b.addEventListener("click", () => userForm(Number(b.dataset.editUsr))));
  $$("[data-del-usr]").forEach((b) => b.addEventListener("click", () => deleteUser(Number(b.dataset.delUsr))));
  $$("[data-qr-usr]").forEach((b) => b.addEventListener("click", () => showQR("user", Number(b.dataset.qrUsr))));

  updateSelButtons();
}

$("#usr-search").addEventListener("input", renderUsers);

function userForm(id) {
  const u = id ? db.users.find((x) => x.id === id) : null;
  openModal(u ? "Edit Karyawan" : "Tambah Karyawan", `
    <div class="form-block">
      <label>Kode Barcode<input id="f-code" type="text" value="${esc(u ? u.user_code : `EMP-${String(db.seq.user).padStart(3, "0")}`)}" /></label>
      <label>Nama Lengkap<input id="f-name" type="text" value="${esc(u ? u.name : "")}" /></label>
      <label>Divisi<select id="f-dept">${db.departments.map((d) => `<option value="${d.id}" ${u && u.department_id === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <label>No. HP / WhatsApp<input id="f-phone" type="text" value="${esc(u ? u.phone_number || "" : "")}" /></label>
      <label>Status<select id="f-ustatus"><option value="active" ${u && u.status === "active" ? "selected" : ""}>Aktif</option><option value="inactive" ${u && u.status === "inactive" ? "selected" : ""}>Nonaktif</option></select></label>
    </div>
    <div class="actions">
      <button id="f-save" class="btn primary">💾 Simpan</button>
      <button id="f-cancel" class="btn ghost">Batal</button>
    </div>
  `);

  $("#f-cancel").addEventListener("click", closeModal);
  $("#f-save").addEventListener("click", () => {
    const code = $("#f-code").value.trim();
    const name = $("#f-name").value.trim();
    if (!code || !name) return toast("Kode dan Nama wajib diisi", "error");
    const dup = db.users.find((x) => x.user_code.toLowerCase() === code.toLowerCase() && (!u || x.id !== u.id));
    if (dup) return toast(`Kode barcode sudah dipakai: ${dup.name}`, "error");

    const data = {
      user_code: code,
      name,
      department_id: Number($("#f-dept").value),
      phone_number: $("#f-phone").value.trim(),
      status: $("#f-ustatus").value,
    };

    if (u) Object.assign(u, data);
    else db.users.push({ id: db.seq.user++, ...data });

    saveDB();
    closeModal();
    renderUsers();
    toast(u ? "Karyawan diperbarui" : "Karyawan ditambahkan", "success");
  });
}

$("#usr-add").addEventListener("click", () => userForm(null));

function deleteUser(id) {
  const u = db.users.find((x) => x.id === id);
  if (!u) return;
  if (db.transactions.some((t) => t.user_id === id && t.status === "borrowed" && !t.returned_at)) return toast("Karyawan masih punya pinjaman aktif", "error");
  if (!confirm(`Hapus karyawan ${u.name} (${u.user_code})?`)) return;
  db.users = db.users.filter((x) => x.id !== id);
  saveDB();
  renderUsers();
  toast("Karyawan dihapus", "success");
}

function buildLabelHtml(items) {
  return items.map((it) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, it.value, { format: "CODE128", width: 1.8, height: 52, displayValue: true, fontSize: 12, margin: 4 });
    return `<div class="label-item">${svg.outerHTML}<div class="label-text"><b>${esc(it.title)}</b><br><small>${esc(it.sub)}</small></div></div>`;
  }).join("");
}

function showQR(kind, id) {
  let value = "";
  let title = "";
  let sub = "";

  if (kind === "device") {
    const d = deviceById(id);
    value = d.barcode;
    title = `${d.brand} ${d.model}`;
    sub = `IMEI: ${d.imei || d.barcode}`;
  } else {
    const u = db.users.find((x) => x.id === id);
    value = u.user_code;
    title = u.name;
    sub = `${u.user_code} · ${deptName(u.department_id)}`;
  }

  openModal("Label Barcode", `
    <div style="text-align:center;">
      <div id="qr-box" style="display:inline-block;padding:16px;border:1px dashed var(--line);border-radius:14px;background:#fff;"></div>
      <p style="margin-top:12px;"><b>${esc(title)}</b><br><small>${esc(sub)}</small><br><span class="code">${esc(value)}</span></p>
      <div class="actions" style="justify-content:center;">
        <button id="qr-print" class="btn primary">🖨 Cetak</button>
        <button id="qr-close" class="btn ghost">Tutup</button>
      </div>
    </div>
  `);

  const box = $("#qr-box");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, { format: "CODE128", width: 2, height: 80, displayValue: true, fontSize: 14, margin: 8 });
  box.appendChild(svg);

  $("#qr-close").addEventListener("click", closeModal);
  $("#qr-print").addEventListener("click", () => {
    const w = window.open("", "_blank");
    if (!w) return toast("Popup diblokir browser. Izinkan popup untuk print label.", "error");
    w.document.write(`<html><head><title>Label ${esc(title)}</title><style>body{font-family:Segoe UI,sans-serif;padding:20px;text-align:center;} p{line-height:1.5;} svg{max-width:100%;height:auto;}@page{margin:10mm;}</style></head><body>${svg.outerHTML}<p><b>${esc(title)}</b><br><small>${esc(sub)}</small></p><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  });
}

function printSelectedLabels(kind) {
  const sel = kind === "device" ? devSel : usrSel;
  if (!sel.size) return toast("Centang dulu baris yang ingin dicetak", "error");

  const items = kind === "device"
    ? db.devices.filter((d) => sel.has(d.id)).map((d) => ({ value: d.barcode, title: `${d.brand} ${d.model}`, sub: d.imei || d.barcode }))
    : db.users.filter((u) => sel.has(u.id)).map((u) => ({ value: u.user_code, title: u.name, sub: `${u.user_code} · ${deptName(u.department_id)}` }));

  const w = window.open("", "_blank");
  if (!w) return toast("Popup diblokir browser — izinkan popup untuk cetak.", "error");

  w.document.write(`<html><head><title>Label Barcode</title><style>body{font-family:Segoe UI,sans-serif;margin:8mm;} .grid{display:grid;grid-template-columns:repeat(3,minmax(140px,1fr));gap:6mm;} .label-item{border:1px dashed #aaa;border-radius:8px;padding:6px;text-align:center;} svg{max-width:100%;height:auto;} .label-text{font-size:12px;line-height:1.35;} @page{margin:8mm;}</style></head><body><div class="grid">${buildLabelHtml(items)}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
  toast(`${items.length} label dikirim ke jendela cetak`, "success");
}

$("#dev-print-sel").addEventListener("click", () => printSelectedLabels("device"));
$("#usr-print-sel").addEventListener("click", () => printSelectedLabels("user"));

function getFilteredTrx() {
  const from = $("#rep-from").value ? new Date($("#rep-from").value + "T00:00:00") : null;
  const to = $("#rep-to").value ? new Date($("#rep-to").value + "T23:59:59") : null;
  const status = $("#rep-status").value;

  return db.transactions.filter((t) => {
    if (t.type === "maintenance") return false;
    const d = new Date(t.borrowed_at);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (status && trxEffectiveStatus(t) !== status) return false;
    return true;
  }).sort((a, b) => new Date(b.borrowed_at) - new Date(a.borrowed_at));
}

function renderReports() {
  const rows = getFilteredTrx();
  $("#rep-table").innerHTML = `
    <thead><tr><th>Kode</th><th>Unit</th><th>Barcode</th><th>Peminjam</th><th>Divisi</th><th>Keluar</th><th>Estimasi</th><th>Kembali</th><th>Durasi</th><th>Awal</th><th>Kembali</th><th>Status</th></tr></thead><tbody>
      ${rows.length ? rows.map((t) => {
        const d = deviceById(t.device_id) || {};
        const u = db.users.find((x) => x.id === t.user_id) || {};
        const status = trxEffectiveStatus(t);
        return `<tr><td><span class="code">${esc(t.transaction_code)}</span></td><td>${esc(d.brand || "")} ${esc(d.model || "")}</td><td><span class="code">${esc(d.barcode || "")}</span></td><td>${esc(u.name || "-")}</td><td>${esc(deptName(u.department_id))}</td><td>${fmtDate(t.borrowed_at)}</td><td>${fmtDate(t.expected_return_at)}</td><td>${fmtDate(t.returned_at)}</td><td>${t.returned_at ? fmtDur(t.borrowed_at, t.returned_at) : fmtDur(t.borrowed_at)}</td><td>${esc(t.initial_condition || "-")}</td><td>${esc(t.return_condition || "-")}</td><td><span class="badge ${status}">${STATUS_LABEL[status]}</span></td></tr>`;
      }).join("") : `<tr><td colspan="12" style="text-align:center;color:var(--muted);padding:18px;">Tidak ada transaksi sesuai filter</td></tr>`}
    </tbody>
  `;
}

$("#rep-filter-btn").addEventListener("click", renderReports);
$("#rep-status").addEventListener("change", renderReports);
$("#rep-from").addEventListener("change", renderReports);
$("#rep-to").addEventListener("change", renderReports);

$("#rep-print").addEventListener("click", () => {
  const rows = getFilteredTrx();
  if (!rows.length) return toast("Tidak ada data untuk dicetak", "error");

  const w = window.open("", "_blank");
  if (!w) return toast("Popup diblokir browser", "error");

  const body = rows.map((t, i) => {
    const d = deviceById(t.device_id) || {};
    const u = db.users.find((x) => x.id === t.user_id) || {};
    const status = trxEffectiveStatus(t);
    return `<tr><td>${i + 1}</td><td>${esc(t.transaction_code)}</td><td>${esc(d.brand || "")} ${esc(d.model || "")}</td><td>${esc(d.barcode || "")}</td><td>${esc(u.name || "-")}</td><td>${esc(deptName(u.department_id))}</td><td>${fmtDate(t.borrowed_at)}</td><td>${fmtDate(t.expected_return_at)}</td><td>${fmtDate(t.returned_at)}</td><td>${t.returned_at ? fmtDur(t.borrowed_at, t.returned_at) : fmtDur(t.borrowed_at)}</td><td>${esc(t.initial_condition || "-")}</td><td>${esc(t.return_condition || "-")}</td><td>${STATUS_LABEL[status]}</td></tr>`;
  }).join("");

  w.document.write(`<html><head><title>Laporan HP</title><style>body{font-family:Segoe UI,sans-serif;margin:12mm;}table{width:100%;border-collapse:collapse;font-size:11px;}th,td{border:1px solid #555;padding:2mm 1.8mm;text-align:left;}@page{size:A4 landscape;margin:12mm;}</style></head><body><h3>Laporan Keluar-Masuk Unit HP</h3><table><thead><tr><th>No</th><th>Kode</th><th>Unit</th><th>Barcode</th><th>Peminjam</th><th>Divisi</th><th>Keluar</th><th>Estimasi</th><th>Kembali</th><th>Durasi</th><th>Awal</th><th>Kembali</th><th>Status</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
});

$("#rep-export").addEventListener("click", () => {
  const rows = getFilteredTrx();
  if (!rows.length) return toast("Tidak ada data untuk di-export", "error");

  const header = ["Kode Transaksi", "Merek", "Model", "Barcode", "Peminjam", "Divisi", "Waktu Keluar", "Estimasi Kembali", "Waktu Kembali", "Durasi (jam)", "Kondisi Awal", "Kondisi Kembali", "Status"];
  const csv = [header].concat(rows.map((t) => {
    const d = deviceById(t.device_id) || {};
    const u = db.users.find((x) => x.id === t.user_id) || {};
    const status = STATUS_LABEL[trxEffectiveStatus(t)];
    const hours = t.returned_at ? ((new Date(t.returned_at) - new Date(t.borrowed_at)) / 3600000).toFixed(1) : ((new Date() - new Date(t.borrowed_at)) / 3600000).toFixed(1);
    return [t.transaction_code, d.brand || "", d.model || "", d.barcode || "", u.name || "", deptName(u.department_id), fmtDate(t.borrowed_at), fmtDate(t.expected_return_at), fmtDate(t.returned_at), hours, t.initial_condition || "", t.return_condition || "", status];
  })).map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `laporan-hp-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV berhasil diunduh", "success");
});

function doBackup(kind) {
  const payload = { app: "hp-barcode-inventory", version: 1, kind, exported_at: new Date().toISOString(), db };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup-hp-inventory-${new Date().toISOString().slice(0, 10)}${kind === "auto" ? "-otomatis" : ""}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updatePwStatus() {
  $("#pw-status").textContent = settings.passcodeHash ? "Status: AKTIF — aplikasi terkunci saat dibuka." : "Status: BELUM AKTIF — aplikasi langsung terbuka.";
}

$("#pw-save").addEventListener("click", () => {
  const current = $("#pw-current").value;
  const next = $("#pw-new").value;
  const confirm = $("#pw-confirm").value;

  if (settings.passcodeHash && hashCode(current) !== settings.passcodeHash) return toast("Kode sandi sekarang salah", "error");
  if (next.length < 4) return toast("Kode sandi baru minimal 4 karakter", "error");
  if (next !== confirm) return toast("Ulangan kode sandi tidak sama", "error");

  settings.passcodeHash = hashCode(next);
  saveSettings();
  $("#pw-current").value = "";
  $("#pw-new").value = "";
  $("#pw-confirm").value = "";
  updatePwStatus();
  toast("Kode sandi disimpan", "success");
});

$("#pw-disable").addEventListener("click", () => {
  if (!settings.passcodeHash) return toast("Kode sandi memang belum aktif", "error");
  if (hashCode($("#pw-current").value) !== settings.passcodeHash) return toast("Kode sandi sekarang salah", "error");

  settings.passcodeHash = null;
  saveSettings();
  $("#pw-current").value = "";
  updatePwStatus();
  toast("Kode sandi dimatikan", "success");
});

function updateBkStatus() {
  $("#bk-status").textContent = settings.lastAutoBackup ? `Backup otomatis terakhir: ${settings.lastAutoBackup}.` : "Backup otomatis belum berjalan.";
}

function checkAutoBackup() {
  const now = new Date();
  if (now.getDate() >= 25) {
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (settings.lastAutoBackup !== key) {
      settings.lastAutoBackup = key;
      saveSettings();
      doBackup("auto");
      toast("Backup otomatis bulan ini dijalankan", "success");
    }
  }
  updateBkStatus();
}

$("#bk-manual").addEventListener("click", () => {
  doBackup("manual");
  toast("Backup file diunduh", "success");
});

$("#bk-restore").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      const data = obj && obj.db && obj.db.devices ? obj.db : (obj && obj.devices ? obj : null);
      if (!data || !data.departments || !data.users || !data.transactions || !data.seq) {
        return toast("File bukan backup yang valid", "error");
      }
      if (!confirm("Data sekarang akan diganti dengan isi backup. Lanjutkan?")) return;
      db = data;
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      clearTimeout(fsTimer);
      if (fsState.mode === "file") fsWriteNow();
      location.reload();
    } catch {
      toast("File tidak bisa dibaca sebagai JSON", "error");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

$("#rs-all").addEventListener("click", async () => {
  if (!confirm("Reset semua data? Semua unit, karyawan, dan transaksi akan dihapus.")) return;
  if (!confirm("Konfirmasi terakhir — data benar-benar akan dihapus.")) return;
  db = defaultDB();
  saveDB();
  clearTimeout(fsTimer);
  if (fsState.mode === "file") {
    try { await fsWriteNow(); } catch {}
  }
  location.reload();
});

function applyTheme(name) {
  const valid = ["light", "slate", "joker"];
  const theme = valid.includes(name) ? name : "light";
  settings.theme = theme;
  saveSettings();
  document.documentElement.setAttribute("data-theme", theme);
  $$(".theme-btn").forEach((b) => b.classList.toggle("primary", b.dataset.themeBtn === theme));
}

$$(".theme-btn").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.themeBtn)));

function showLock() {
  document.body.classList.add("locked");
  $("#lock-screen").classList.remove("hidden");
  setTimeout(() => $("#lock-input").focus(), 50);
}

function tryUnlock() {
  const value = $("#lock-input").value;
  if (hashCode(value) === settings.passcodeHash) {
    document.body.classList.remove("locked");
    $("#lock-screen").classList.add("hidden");
    $("#lock-input").value = "";
    clearMsg($("#lock-msg"));
    startApp();
  } else {
    showMsg($("#lock-msg"), "❌ Kode sandi salah, coba lagi.", "error");
    $("#lock-input").value = "";
    $("#lock-input").focus();
  }
}

$("#lock-btn").addEventListener("click", tryUnlock);
$("#lock-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryUnlock();
});

function fsSupported() {
  return typeof window.showSaveFilePicker === "function" && !!window.indexedDB;
}

async function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("hp_inventory_fs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key, val) {
  const dbx = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction("kv", "readwrite");
    tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const dbx = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function showBanner(text, kind, btnLabel, fn) {
  const b = $("#file-banner");
  if (!b) return;
  b.className = `file-banner ${kind || "warn"}`;
  b.innerHTML = `<span>${text}</span>${btnLabel ? `<button class="btn small" id="file-banner-btn">${btnLabel}</button>` : ""}`;
  bannerAction = fn || null;
  if (btnLabel) {
    $("#file-banner-btn").addEventListener("click", () => {
      if (bannerAction) bannerAction();
    });
  }
}

function hideBanner() {
  const b = $("#file-banner");
  if (!b) return;
  b.className = "file-banner hidden";
  b.innerHTML = "";
  bannerAction = null;
}

async function fsReadFile() {
  const f = await fsState.handle.getFile();
  const txt = await f.text();
  if (!txt.trim()) throw new Error("file kosong");
  const obj = JSON.parse(txt);
  const data = obj && obj.db && obj.db.devices ? obj.db : (obj && obj.devices ? obj : null);
  if (!data || !data.departments || !data.users || !data.devices || !data.transactions || !data.seq) throw new Error("isi file bukan data aplikasi ini");
  return { data, savedAt: obj && obj.saved_at ? obj.saved_at : null };
}

async function fsWriteNow() {
  if (fsState.mode !== "file" || !fsState.handle) return false;
  const savedAt = new Date().toISOString();
  try {
    const w = await fsState.handle.createWritable();
    await w.write(JSON.stringify({ app: "hp-barcode-inventory", version: 1, saved_at: savedAt, db }, null, 2));
    await w.close();
    fsState.lastSave = savedAt;
    settings.lastFileSave = savedAt;
    settings.lastSeenFileSave = savedAt;
    saveSettings();
    hideBanner();
    updateFsStatus();
    return true;
  } catch (e) {
    showBanner(`⚠️ Gagal menulis ke file <b>${esc(fsState.name)}</b> (${esc(e.message)}).`, "error", "🔗 Sambung Ulang", () => fsReconnect(false));
    return false;
  }
}

function scheduleFileWrite() {
  if (fsState.mode !== "file") return;
  clearTimeout(fsTimer);
  fsTimer = setTimeout(() => { fsTimer = null; fsWriteNow(); }, 400);
}

async function fsReconnect(silent) {
  if (!fsSupported()) {
    if (!silent) toast("Browser ini tidak mendukung simpan ke file. Gunakan Chrome atau Edge.", "error");
    return false;
  }

  let handle = fsState.handle || (await idbGet("handle").catch(() => null));
  if (!handle) {
    if (!silent) toast("Belum ada file data yang dipilih. Klik 'Aktifkan Simpan ke File' dulu.", "error");
    return false;
  }

  fsState.handle = handle;
  fsState.name = handle.name;
  try {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") permission = await handle.requestPermission({ mode: "readwrite" });
  } catch {}

  let file = null;
  let readError = null;
  try {
    file = await fsReadFile();
  } catch (e) {
    readError = e;
  }

  if (readError && readError.name === "NotAllowedError") {
    showBanner(`📁 Aplikasi belum dapat mengakses file <b>${esc(handle.name)}</b>. Klik tombol untuk memberi izin.`, "warn", "🔗 Izinkan & Sambungkan", () => fsReconnect(false));
    updateFsStatus();
    return false;
  }

  fsState.mode = "file";
  settings.fileMode = true;
  saveSettings();

  if (!file) {
    const wrote = await fsWriteNow();
    if (!wrote) {
      fsState.mode = "browser";
      settings.fileMode = false;
      saveSettings();
      updateFsStatus();
      return false;
    }
    updateFsStatus();
    refreshAll();
    if (!silent) toast(`File ${handle.name} masih kosong — data ditulis ke file itu.`, "success");
    return true;
  }

  const fileData = file.data;
  let useFile = false;
  if (JSON.stringify(fileData) !== JSON.stringify(db)) {
    if (silent) {
      useFile = !(settings.lastSeenFileSave && file.savedAt === settings.lastSeenFileSave);
    } else {
      useFile = confirm(`Data di FILE dan di BROWSER berbeda.\n\nPakai FILE (${handle.name})?\nOK = file menang\nCancel = browser menang`);
    }
    if (useFile) {
      db = fileData;
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    }
  }

  await fsWriteNow();
  updateFsStatus();
  refreshAll();
  if (!silent) toast(`Tersambung ke file ${handle.name}`, "success");
  return true;
}

async function fsEnable() {
  if (!fsSupported()) return toast("Browser ini tidak mendukung simpan ke file. Gunakan Chrome atau Edge terbaru.", "error");

  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: "data-hp-inventory.json",
      types: [{ description: "File data aplikasi (JSON)", accept: { "application/json": [".json"] } }],
    });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    return toast("Gagal membuka dialog simpan file: " + e.message, "error");
  }

  fsState.handle = handle;
  fsState.name = handle.name;
  fsState.mode = "file";
  try { await handle.requestPermission({ mode: "readwrite" }); } catch {}
  try { await idbSet("handle", handle); } catch {}

  let fileData = null;
  try { fileData = (await fsReadFile()).data; } catch {}
  settings.fileMode = true;
  saveSettings();

  if (fileData && JSON.stringify(fileData) !== JSON.stringify(db)) {
    const useFile = confirm(`File yang dipilih sudah berisi data.\n\nPakai data FILE?\nOK = file menang\nCancel = browser menang`);
    if (useFile) {
      db = fileData;
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    }
  }

  const ok = await fsWriteNow();
  if (!ok) {
    fsState.mode = "browser";
    settings.fileMode = false;
    saveSettings();
    updateFsStatus();
    return;
  }

  updateFsStatus();
  refreshAll();
  toast(`Simpan ke file aktif — ${handle.name}`, "success");
}

async function fsDisable() {
  if (fsState.mode !== "file") return toast("Memang belum aktif", "error");
  if (!confirm(`Matikan penyimpanan ke file? Data tetap ada di browser, tapi tidak lagi ditulis ke ${fsState.name}.`)) return;
  clearTimeout(fsTimer);
  fsState.mode = "browser";
  settings.fileMode = false;
  saveSettings();
  hideBanner();
  updateFsStatus();
  toast("Penyimpanan ke file dimatikan", "success");
}

function updateFsStatus() {
  const el = $("#fs-status");
  if (el) {
    if (fsState.mode === "file") {
      el.innerHTML = `Status: <b>AKTIF</b> — data disimpan ke file <b>${esc(fsState.name)}</b>.${fsState.lastSave ? ` Terakhir Tersimpan: ${fmtDate(fsState.lastSave)}.` : ""}`;
    } else if (!fsSupported()) {
      el.textContent = "Browser ini tidak mendukung penyimpanan ke file.";
    } else {
      el.textContent = "Status: BELUM AKTIF — data hanya tersimpan di browser ini.";
    }
  }

  const reconnect = $("#fs-reconnect");
  if (reconnect) reconnect.classList.toggle("hidden", !(fsState.handle && fsState.mode !== "file"));
  const reload = $("#fs-reload");
  if (reload) reload.classList.toggle("hidden", fsState.mode !== "file");
  const off = $("#fs-off");
  if (off) off.classList.toggle("hidden", fsState.mode !== "file");

  const sidebar = $("#sidebar-store");
  if (sidebar) {
    sidebar.textContent = fsState.mode === "file" ? `💾 Data tersimpan di file\n${fsState.name}` : "Data tersimpan lokal di browser";
    sidebar.style.whiteSpace = "pre-line";
  }
}

function refreshAll() {
  goto(currentPage);
}

async function fsInit() {
  fsState.lastSave = settings.lastFileSave || null;
  updateFsStatus();
  const handle = await idbGet("handle").catch(() => null);
  if (!handle) return;
  fsState.handle = handle;
  fsState.name = handle.name;
  let permission = "denied";
  try { permission = await handle.queryPermission({ mode: "readwrite" }); } catch {}
  if (permission === "granted") {
    await fsReconnect(true);
  } else {
    showBanner(`📁 File ${esc(handle.name)} sudah tersambung ke browser. Klik tombol untuk mengizinkan akses.`, "info", "🔗 Sambungkan", () => fsReconnect(false));
    updateFsStatus();
  }
}

function startApp() {
  checkAutoBackup();
  renderDashboard();
  fsInit();
}

function init() {
  loadDB();
  loadSettings();
  applyTheme(settings.theme);
  updatePwStatus();
  updateBkStatus();
  updateFsStatus();
  if (settings.passcodeHash) showLock();
  else startApp();
}

$$(".nav-btn").forEach((b) => b.addEventListener("click", () => goto(b.dataset.page)));
$("#fs-enable").addEventListener("click", fsEnable);
$("#fs-reconnect").addEventListener("click", () => fsReconnect(false));
$("#fs-off").addEventListener("click", fsDisable);
$("#fs-reload").addEventListener("click", async () => {
  if (fsState.mode !== "file") return;
  if (!confirm(`Muat ulang data dari file ${fsState.name}?`)) return;
  try {
    const { data } = await fsReadFile();
    db = data;
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    settings.lastSeenFileSave = null;
    saveSettings();
    refreshAll();
    toast("Data dimuat ulang dari file", "success");
  } catch (e) {
    toast("Gagal membaca file: " + e.message, "error");
  }
});

window.addEventListener("beforeunload", () => {
  if (fsTimer) {
    clearTimeout(fsTimer);
    fsTimer = null;
    fsWriteNow();
  }
});

$$(".cam-btn").forEach((btn) => btn.addEventListener("click", () => {
  const target = btn.dataset.scanTarget;
  openScanner((text) => {
    if (target === "user") coHandleUserCode(text);
    if (target === "device") coHandleDeviceCode(text);
    if (target === "checkin") ciHandleDeviceCode(text);
    if (target === "maintenance") mtHandleDevice(text);
    if (target === "maintenance-user") mtHandleUser(text);
  });
}));

init();
