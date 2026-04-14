/**
 * DashboardTemplate.js
 * Cung cấp HTML và logic hiển thị cho Dashboard Sync Manager.
 */

function getDashboardTemplate(data, initialRows, labels) {
  const tableContent =
    initialRows ||
    '<div style="padding:40px; text-align:center; color:#94a3b8">Chưa có dữ liệu</div>';

  const safeLabels = JSON.stringify(Array.isArray(labels) ? labels : []);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"><title>SNPDocSync Dashboard</title>
  <link href="/assets/inter/vietnamese.css" rel="stylesheet">
  <link href="/assets/bootstrap-icons/font/bootstrap-icons.css" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #f0f4f8; margin: 0; padding: 20px; overflow: hidden; height: 100vh; box-sizing: border-box; }
    .dash-card { background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .header { background: #1e3a5f; color: white; padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; }
    .badge { padding: 5px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
    .ready { background: #22c55e33; color: #4ade80; }
    .syncing { background: #3b82f633; color: #60a5fa; }
    .action-bar { padding: 15px 25px; border-bottom: 1px solid #eee; display: flex; gap: 10px; }
    .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.8rem; font-weight: 600; }
    .btn-p { background: #2563eb; color: white; }
    .btn-d { background: #dc2626; color: white; }
    .table-wrapper { flex: 1; overflow: auto; padding: 0 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { position: sticky; top: 0; background: #f8fafc; padding: 12px; text-align: left; color: #64748b; font-size: 0.7rem; text-transform: uppercase; }
    td { padding: 12px; border-bottom: 1px solid #f1f5f9; }
    .model-chip { background: #eff6ff; color: #1d4ed8; padding: 4px 10px; border-radius: 6px; font-weight: 700; }
    .status-badge { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; font-size: 0.7rem; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .prog-wrap { background: #e2e8f0; height: 6px; border-radius: 10px; width: 80px; overflow: hidden; }
    .prog-fill { height: 100%; background: #3b82f6; transition: 0.3s; }
    .act-btn { padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd; cursor: pointer; font-size: 0.7rem; margin-right: 2px; }
    .act-btn:disabled { opacity: 0.5; cursor: not-allowed; background: #f1f5f9; color: #94a3b8; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    tr.header-row { background: #f8fafc; }
    .indent { padding-left: 30px !important; color: #64748b; }
    .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 1000; }
    .modal-c { background: white; padding: 20px; border-radius: 10px; width: 350px; }
    .form-control { width: 100%; padding: 8px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; }
  </style>
</head>
<body>
  <div id="modal" class="modal"><div class="modal-c">
    <div style="font-weight:700; margin-bottom:15px">Dải KH: <span id="m-name"></span></div>
    Từ: <input type="datetime-local" id="f" class="form-control">
    Đến: <input type="datetime-local" id="t" class="form-control">
    <label style="font-size:0.8rem; display:flex; align-items:center; gap:5px; margin-bottom:15px; cursor:pointer">
      <input type="checkbox" id="res"> Xóa lịch sử đồng bộ (Reset)
    </label>
    <div id="modal-error" style="color:#ef4444; font-size:0.75rem; margin: 10px 0; display:none; background:#fef2f2; padding:8px; border-radius:4px; border: 1px solid #fee2e2;"></div>
    <div style="display:flex; justify-content:flex-end; gap:8px">
      <button class="btn btn-p" onclick="sub()">Tạo Job</button>
      <button class="btn" onclick="cls()">Đóng</button>
    </div>
  </div></div>

  <div class="dash-card">
    <div class="header">
      <div>
        <div style="font-weight:700">SNP SYNC - BẢNG ĐIỀU KHIỂN</div>
        <div style="font-size:0.7rem; opacity:0.7">Hệ thống đồng bộ dữ liệu Tân Cảng</div>
      </div>
      <div id="b" class="badge ${data.isRunning ? 'syncing' : 'ready'}">${data.isRunning ? 'Đang chạy' : 'Sẵn sàng'}</div>
    </div>
    <div class="action-bar">
      <button class="btn btn-p" onclick="runAll(false)">Chạy tất cả</button>
      <button class="btn btn-d" onclick="runAll(true)">Reset toàn bộ</button>
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Đối tượng / Job</th><th>Trạng thái</th><th>Tiến trình</th><th>Số lượng</th><th>Dải thời gian</th><th>Port</th><th>Chi tiết</th><th>Hành động</th></tr></thead>
        <tbody id="tbody">${tableContent}</tbody>
      </table>
    </div>
    <div style="padding:10px 25px; font-size:0.7rem; color:#94a3b8; border-top:1px solid #eee">
      Realtime update active | <span id="last-update"></span> | <span id="action-msg"></span>
    </div>
  </div>

  <script>
    let _es = null;
    let _msgTimer = null;

    function setActionMessage(msg, isError = false) {
      const el = document.getElementById('action-msg');
      if (!el) return;
      el.textContent = msg || '';
      el.style.color = isError ? '#dc2626' : '#16a34a';
      if (_msgTimer) clearTimeout(_msgTimer);
      _msgTimer = setTimeout(() => { el.textContent = ''; }, 6000);
    }

    function connect() {
      _es = new EventSource('/api/sync-manager-src/events');
      _es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          document.getElementById('b').className = 'badge ' + (d.isRunning ? 'syncing' : 'ready');
          document.getElementById('b').textContent = d.isRunning ? 'Đang chạy' : 'Sẵn sàng';

          const labels = ${safeLabels};
          const f = {};
          if (d.entities) {
            labels.forEach((l) => { if (d.entities[l]) f[l] = d.entities[l]; });
          }

          document.getElementById('tbody').innerHTML = buildRows(f, d.jobs || {});
          document.getElementById('last-update').textContent = 'Cập nhật: ' + new Date().toLocaleTimeString();
        } catch (err) {
          console.error('SSE Error:', err);
        }
      };
    }

    function buildRows(ents, jobs) {
      let h = '';
      for (const [n, i] of Object.entries(ents)) {
        h += buildHeaderRow(n, i);
        const rel = Object.values(jobs).filter((j) => j.modelName === n).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
        rel.forEach((j) => { h += buildJobRow(n, i, j); });
      }
      return h;
    }

    function buildHeaderRow(name, info) {
      const isBusy = ['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(info.status);
      return \`<tr class="header-row"><td colspan="7"><span class="model-chip">\${name}</span></td><td>
        <button class="act-btn" onclick="start('\${name}', false)" \${isBusy ? 'disabled' : ''}>Chạy</button>
        <button class="act-btn" style="background:#6366f1; color:white" onclick="openM('\${name}')">Dải KH</button>
      </td></tr>\`;
    }

    function buildJobRow(name, info, job) {
      const ms = (job.status || 'IDLE').toUpperCase();
      const p = job.totalToSync ? Math.round((job.totalSuccess / job.totalToSync) * 100) : 0;
      return \`<tr>
        <td class="indent">-> \${job.jobId}</td>
        <td><span class="status-badge" style="color:\${job.status === 'RUNNING' ? '#2563eb' : '#64748b'}"><span class="dot"></span>\${ms}</span></td>
        <td><div class="prog-wrap"><div class="prog-fill" style="width:\${p}%"></div></div></td>
        <td>\${job.totalSuccess} / \${job.totalToSync || '—'}</td>
        <td style="font-size:0.65rem">T: \${job.fromTime ? new Date(job.fromTime).toLocaleString('vi-VN') : '—'}<br>Đ: \${job.toTime ? new Date(job.toTime).toLocaleString('vi-VN') : '—'}</td>
        <td style="font-family:monospace">\${job.serverPort}</td>
        <td style="font-size:0.7rem; color:#94a3b8">\${job.status}</td>
        <td>
          <button class="act-btn" onclick="resume('\${job.jobId}', false)" \${['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(job.status) ? 'disabled' : ''}>Chạy</button>
          <button class="act-btn" onclick="resume('\${job.jobId}', true)" \${['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(job.status) ? 'disabled' : ''}>Lại</button>
          <button class="act-btn" onclick="pause('\${job.jobId}')" \${['RUNNING', 'RESUMING'].includes(job.status) ? '' : 'disabled'}>Dừng</button>
          <button class="act-btn" onclick="resume('\${job.jobId}', false)" \${job.status === 'PAUSED' || job.status === 'PAUSE_REQUESTED' ? '' : 'disabled'}>Tiếp</button>
        </td></tr>\`;
    }

    const api = async (u, b = {}) => {
      try {
        const r = await fetch('/api/sync-manager-src' + u, {
          method: 'POST',
          body: JSON.stringify(b),
          headers: { 'Content-Type': 'application/json' }
        });

        const raw = await r.text();
        let res = {};
        try {
          res = raw ? JSON.parse(raw) : {};
        } catch (_) {
          res = { message: raw };
        }

        const isOk = r.ok && res.success !== false;
        if (!isOk) {
          const detail = (res && typeof res.error === 'string' && res.error.trim()) ? res.error.trim() : '';
          const serverMsg = (res && typeof res.message === 'string') ? res.message.trim() : '';
          const isGenericServerMsg = !serverMsg || /^error$/i.test(serverMsg) || /^internal server error$/i.test(serverMsg);
          const msg = (!isGenericServerMsg ? serverMsg : '') || detail || ('HTTP ' + r.status);
          setActionMessage(msg, true);
          throw new Error(msg);
        }

        if (res && res.message) {
          setActionMessage(res.message, false);
        }
        return res;
      } catch (e) {
        setActionMessage('Lỗi: ' + e.message, true);
        throw e;
      }
    };

    const runAll = (r) => api('/start', { reset: r }).catch(() => {});
    const start = (n, r, f, t) => api('/models/' + encodeURIComponent(n) + '/start', { reset: r, fromTime: f, toTime: t }).catch(() => {});
    const pause = (id) => api('/jobs/' + encodeURIComponent(id) + '/pause').catch(() => {});
    const resume = (id, r = false) => api('/jobs/' + encodeURIComponent(id) + '/resume', { reset: r }).catch(() => {});

    let _m = null;
    function openM(n) {
      _m = n;
      document.getElementById('m-name').textContent = n;
      if (document.getElementById('res')) document.getElementById('res').checked = false;
      const errEl = document.getElementById('modal-error');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      document.getElementById('modal').style.display = 'flex';
    }
    function cls() { document.getElementById('modal').style.display = 'none'; }
    function sub() {
      const f = document.getElementById('f').value;
      const t = document.getElementById('t').value;
      const r = document.getElementById('res') ? document.getElementById('res').checked : false;
      const errEl = document.getElementById('modal-error');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      api('/models/' + encodeURIComponent(_m) + '/start', {
        reset: r,
        fromTime: f ? new Date(f).toISOString() : null,
        toTime: t ? new Date(t).toISOString() : null
      }).then(() => {
        cls();
      }).catch((e) => {
        if (errEl) {
          errEl.textContent = e.message;
          errEl.style.display = 'block';
        }
      });
    }

    connect();
  </script>
</body>
</html>`;
}

function renderServerRows(entities, jobs) {
  let h = '';
  for (const [name, info] of Object.entries(entities || {})) {
    const isBusy = ['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(info.status);
    h += `<tr class="header-row"><td colspan="7"><span class="model-chip">${name}</span></td><td>
      <button class="act-btn" onclick="start('${name}', false)" ${isBusy ? 'disabled' : ''}>Chạy</button>
      <button class="act-btn" style="background:#6366f1; color:white" onclick="openM('${name}')">Dải KH</button>
    </td></tr>`;

    const rel = Object.values(jobs || {})
      .filter((j) => j.modelName === name)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    rel.forEach((j) => {
      const p = j.totalToSync ? Math.round((j.totalSuccess / j.totalToSync) * 100) : 0;
      h += `<tr>
        <td class="indent">-> ${j.jobId}</td>
        <td>${j.status}</td>
        <td><div class="prog-wrap"><div class="prog-fill" style="width:${p}%"></div></div></td>
        <td>${j.totalSuccess} / ${j.totalToSync || '—'}</td>
        <td style="font-size:0.65rem">T: ${j.fromTime ? new Date(j.fromTime).toLocaleString('vi-VN') : '—'}<br>Đ: ${j.toTime ? new Date(j.toTime).toLocaleString('vi-VN') : '—'}</td>
        <td style="font-family:monospace">${j.serverPort || ''}</td>
        <td>${j.status || ''}</td>
        <td>
          <button class="act-btn" onclick="resume('${j.jobId}', false)" ${['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(j.status) ? 'disabled' : ''}>Chạy</button>
          <button class="act-btn" onclick="resume('${j.jobId}', true)" ${['RUNNING', 'RESUMING', 'PAUSE_REQUESTED'].includes(j.status) ? 'disabled' : ''}>Lại</button>
          <button class="act-btn" onclick="pause('${j.jobId}')" ${['RUNNING', 'RESUMING'].includes(j.status) ? '' : 'disabled'}>Dừng</button>
          <button class="act-btn" onclick="resume('${j.jobId}', false)" ${j.status === 'PAUSED' || j.status === 'PAUSE_REQUESTED' ? '' : 'disabled'}>Tiếp</button>
        </td>
      </tr>`;
    });
  }
  return h;
}

module.exports = {
  getDashboardTemplate,
  renderServerRows
};
