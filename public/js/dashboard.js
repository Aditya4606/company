document.addEventListener('DOMContentLoaded', () => {
    const reportsList = document.getElementById('reportsList');
    const emptyState = document.getElementById('emptyState');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionText = document.getElementById('connectionText');
    const loginOverlay = document.getElementById('loginOverlay');
    const mainContent = document.getElementById('mainContent');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const logoutBtn = document.getElementById('logoutBtn');
    const assignModal = document.getElementById('assignModal');
    const assignForm = document.getElementById('assignForm');
    const assignStaffSelect = document.getElementById('assignStaffSelect');
    const cancelAssign = document.getElementById('cancelAssign');
    const assignReportInfo = document.getElementById('assignReportInfo');

    let authToken = localStorage.getItem('maintenance_token');
    let allReports = [];
    let staffList = [];
    let currentFilter = 'all';
    let isFirstLoad = true;
    let assigningReportId = null;

    // Staff elements
    const staffListEl = document.getElementById('staffList');
    const staffEmpty = document.getElementById('staffEmpty');
    const addStaffBtn = document.getElementById('addStaffBtn');
    const addStaffModal = document.getElementById('addStaffModal');
    const cancelAddStaff = document.getElementById('cancelAddStaff');
    const addStaffForm = document.getElementById('addStaffForm');

    // ─── Auth ───────────────────────────────────────────────────────────────
    checkAuth();

    async function checkAuth() {
        if (!authToken) return showLogin();
        try {
            const res = await fetch('/api/auth/check', { headers: { 'x-auth-token': authToken } });
            const data = await res.json();
            if (data.authenticated) showDashboard();
            else { localStorage.removeItem('maintenance_token'); authToken = null; showLogin(); }
        } catch { showLogin(); }
    }

    function showLogin() { loginOverlay.style.display = 'flex'; mainContent.style.display = 'none'; }

    function showDashboard() {
        loginOverlay.style.display = 'none';
        mainContent.style.display = 'block';
        loadStaff();
        loadReports();
        loadStats();
        connectSSE();
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pin = document.getElementById('pinInput').value;
        loginError.style.display = 'none';
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin }),
            });
            if (res.ok) {
                const data = await res.json();
                authToken = data.token;
                localStorage.setItem('maintenance_token', authToken);
                showDashboard();
            } else {
                loginError.textContent = '❌ Invalid PIN. Please try again.';
                loginError.style.display = 'block';
                document.getElementById('pinInput').value = '';
                document.getElementById('pinInput').focus();
            }
        } catch {
            loginError.textContent = '❌ Connection error. Try again.';
            loginError.style.display = 'block';
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-auth-token': authToken } }); } catch { }
        localStorage.removeItem('maintenance_token');
        authToken = null;
        showLogin();
    });

    function authHeaders(extra = {}) { return { 'x-auth-token': authToken, ...extra }; }

    // ─── Staff ──────────────────────────────────────────────────────────────
    async function loadStaff() {
        try {
            const res = await fetch('/api/staff', { headers: authHeaders() });
            staffList = await res.json();
            renderStaffList();
        } catch { }
    }

    function renderStaffList() {
        if (!staffListEl || !staffEmpty) return; // safety check

        if (staffList.length === 0) {
            staffListEl.innerHTML = '';
            staffEmpty.style.display = 'block';
            return;
        }

        staffEmpty.style.display = 'none';
        staffListEl.innerHTML = staffList.map(s => `
        <div class="glass-card" style="display: flex; justify-content: space-between; align-items: center; padding: 16px;">
          <div>
            <div style="font-weight: 600; font-size: 1rem;">${escapeHtml(s.name)}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">
              ${s.role}${s.phone ? ` · 📞 ${s.phone}` : ''}${s.email ? ` · ✉️ ${s.email}` : ''}
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" data-remove-staff="${s.id}" title="Remove">🗑️</button>
        </div>
      `).join('');

        // Attach remove handlers
        staffListEl.querySelectorAll('[data-remove-staff]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const staffId = parseInt(btn.dataset.removeStaff);
                if (!confirm(`Remove ${staffList.find(s => s.id === staffId)?.name}?`)) return;
                try {
                    await fetch(`/api/staff/${staffId}`, {
                        method: 'DELETE',
                        headers: authHeaders(),
                    });
                    showToast('Staff removed', 'success');
                    loadStaff(); // Reload the whole list to keep assignment dropdown in sync too
                } catch { showToast('Failed to remove', 'error'); }
            });
        });
    }

    if (addStaffBtn) addStaffBtn.addEventListener('click', () => addStaffModal.classList.add('visible'));
    if (cancelAddStaff) cancelAddStaff.addEventListener('click', () => { addStaffModal.classList.remove('visible'); addStaffForm.reset(); });

    if (addStaffForm) {
        addStaffForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('staffName').value.trim();
            const phone = document.getElementById('staffPhone').value.trim();
            const email = document.getElementById('staffEmail').value.trim();
            const role = document.getElementById('staffRole').value;
            if (!name) { showToast('Name is required', 'error'); return; }

            try {
                const res = await fetch('/api/staff', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ name, phone, email, role }),
                });
                if (res.ok) {
                    showToast(`✅ ${name} added to team!`, 'success');
                    addStaffModal.classList.remove('visible');
                    addStaffForm.reset();
                    loadStaff();
                } else showToast('Failed to add', 'error');
            } catch { showToast('Network error', 'error'); }
        });
    }

    // ─── Assignment Modal ───────────────────────────────────────────────────
    function openAssignModal(reportId) {
        const report = allReports.find(r => r.id === reportId);
        if (!report) return;

        assigningReportId = reportId;
        assignReportInfo.textContent = `#${report.id} — ${report.machine_name}: ${report.error_message}`;

        // Fill dropdown
        assignStaffSelect.innerHTML = '<option value="">— Select Staff —</option>';
        staffList.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.name} (${s.role})`;
            assignStaffSelect.appendChild(opt);
        });

        assignModal.classList.add('visible');
    }

    cancelAssign.addEventListener('click', () => {
        assignModal.classList.remove('visible');
        assigningReportId = null;
    });

    assignForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const staffId = assignStaffSelect.value;
        if (!staffId || !assigningReportId) return;

        try {
            const res = await fetch(`/api/reports/${assigningReportId}/assign`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ staff_id: parseInt(staffId) }),
            });
            if (res.ok) {
                showToast(`✅ Report assigned!`, 'success');
                assignModal.classList.remove('visible');
                assigningReportId = null;
            } else {
                showToast('Failed to assign', 'error');
            }
        } catch {
            showToast('Network error', 'error');
        }
    });

    // ─── SSE ────────────────────────────────────────────────────────────────
    let eventSource;

    function connectSSE() {
        if (eventSource) eventSource.close();
        eventSource = new EventSource('/api/events');

        eventSource.onopen = () => {
            connectionStatus.className = 'connection-status connected';
            connectionText.textContent = 'Live';
        };

        eventSource.addEventListener('new_report', (e) => {
            const report = JSON.parse(e.data);
            allReports.unshift(report);
            renderReports();
            loadStats();
            playAlertSound();
            showToast(`🚨 New: ${report.machine_name} — ${report.error_message}`, 'error');
        });

        eventSource.addEventListener('report_updated', (e) => {
            const updated = JSON.parse(e.data);
            const idx = allReports.findIndex(r => r.id === updated.id);
            if (idx !== -1) allReports[idx] = updated;
            renderReports();
            loadStats();
        });

        eventSource.onerror = () => {
            connectionStatus.className = 'connection-status disconnected';
            connectionText.textContent = 'Reconnecting…';
            eventSource.close();
            setTimeout(connectSSE, 3000);
        };
    }

    // ─── Filters ────────────────────────────────────────────────────────────
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderReports();
        });
    });

    // ─── Load data ──────────────────────────────────────────────────────────
    async function loadReports() {
        try {
            const res = await fetch('/api/reports', { headers: authHeaders() });
            allReports = await res.json();
            isFirstLoad = false;
            renderReports();
        } catch { showToast('Failed to load reports', 'error'); }
    }

    async function loadStats() {
        try {
            const res = await fetch('/api/stats', { headers: authHeaders() });
            const s = await res.json();
            document.getElementById('statCritical').textContent = s.critical_open || 0;
            document.getElementById('statOpen').textContent = s.open_count || 0;
            document.getElementById('statInProgress').textContent = s.in_progress_count || 0;
            document.getElementById('statResolved').textContent = s.resolved_count || 0;
        } catch { }
    }

    // ─── Render ─────────────────────────────────────────────────────────────
    function renderReports() {
        const filtered = currentFilter === 'all' ? allReports : allReports.filter(r => r.status === currentFilter);

        if (filtered.length === 0) {
            reportsList.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        reportsList.innerHTML = filtered.map((r, i) => createReportCard(r, i === 0 && !isFirstLoad)).join('');

        // Event listeners
        reportsList.querySelectorAll('[data-assign]').forEach(btn => {
            btn.addEventListener('click', () => openAssignModal(parseInt(btn.dataset.assign)));
        });
        reportsList.querySelectorAll('[data-resolve]').forEach(btn => {
            btn.addEventListener('click', () => updateReportStatus(btn.dataset.resolve, 'resolved'));
        });
    }

    function createReportCard(report, isNew) {
        const time = formatTime(report.reported_at);
        const priorityBadge = `<span class="badge badge-${report.priority}">${report.priority}</span>`;
        const statusBadge = `<span class="badge badge-${report.status.replace('_', '-')}">${formatStatus(report.status)}</span>`;

        let photo = '';
        if (report.photo_path) {
            photo = `<div class="report-photo"><img src="${report.photo_path}" alt="Error photo" loading="lazy"></div>`;
        }

        let assignedInfo = '';
        if (report.assigned_to_name) {
            assignedInfo = `<div style="font-size:0.8rem; color:var(--accent-blue); margin-top:8px;">
        👷 Assigned to: <strong>${escapeHtml(report.assigned_to_name)}</strong>${report.assigned_to_phone ? ` (📞 ${report.assigned_to_phone})` : ''}
      </div>`;
        }

        let actions = '';
        if (report.status === 'open') {
            actions = `<button class="btn btn-warning btn-sm" data-assign="${report.id}">👷 Assign</button>`;
        } else if (report.status === 'in_progress') {
            actions = `<button class="btn btn-warning btn-sm" data-assign="${report.id}" style="margin-right:4px;">👷 Reassign</button>
                 <button class="btn btn-success btn-sm" data-resolve="${report.id}">✅ Resolved</button>`;
        }

        let resolvedInfo = '';
        if (report.status === 'resolved' && report.resolved_at) {
            resolvedInfo = `<div style="font-size:0.75rem; color:var(--accent-green); margin-top:8px;">
        ✅ Resolved ${formatTime(report.resolved_at)}${report.resolved_by ? ` by ${report.resolved_by}` : ''}
      </div>`;
        }

        return `
      <div class="glass-card report-card ${isNew ? 'new-alert' : ''}">
        <div class="report-header">
          <div>
            <span class="report-id">#${report.id}</span>
            <div class="report-machine">${report.machine_name}</div>
            <div class="report-location">📍 ${report.machine_location}</div>
          </div>
          <div class="report-time">${time}</div>
        </div>
        <div class="report-error">⚠️ ${escapeHtml(report.error_message)}</div>
        ${report.description ? `<div class="report-description">${escapeHtml(report.description)}</div>` : ''}
        ${photo}
        ${assignedInfo}
        <div class="report-footer">
          <div>${priorityBadge} ${statusBadge}</div>
          <div class="report-actions">${actions}</div>
        </div>
        ${resolvedInfo}
        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:8px;">Reported by: ${escapeHtml(report.reported_by || 'Operator')}</div>
      </div>
    `;
    }

    // ─── Update report ─────────────────────────────────────────────────────
    async function updateReportStatus(reportId, newStatus) {
        try {
            const res = await fetch(`/api/reports/${reportId}`, {
                method: 'PATCH',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ status: newStatus, resolved_by: 'Maintenance' }),
            });
            if (res.ok) showToast(`Report #${reportId} resolved ✅`, 'success');
            else showToast('Failed to update', 'error');
        } catch { showToast('Network error', 'error'); }
    }

    // ─── Audio ──────────────────────────────────────────────────────────────
    function playAlertSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.3;
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.stop(ctx.currentTime + 0.5);
        } catch { }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────
    function formatTime(dateStr) {
        const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
        const diff = (new Date() - d) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    function formatStatus(s) { return s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()); }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} visible`;
        setTimeout(() => toast.classList.remove('visible'), 4000);
    }
});
