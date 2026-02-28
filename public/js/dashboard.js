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

    // Monthly stats elements
    const monthlyReportBtn = document.getElementById('monthlyReportBtn');
    const monthlyModal = document.getElementById('monthlyModal');
    const closeMonthlyModal = document.getElementById('closeMonthlyModal');
    const monthSelector = document.getElementById('monthSelector');
    const fetchMonthlyBtn = document.getElementById('fetchMonthlyBtn');
    const monthlyStatsContainer = document.getElementById('monthlyStatsContainer');

    // Manage Machines elements
    const manageMachinesBtn = document.getElementById('manageMachinesBtn');
    const manageMachinesModal = document.getElementById('manageMachinesModal');
    const closeManageMachinesModal = document.getElementById('closeManageMachinesModal');
    const manageMachinesList = document.getElementById('manageMachinesList');

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
            if (data.authenticated) {
                localStorage.setItem('user_role', data.role);
                showDashboard(data.role);
            }
            else { localStorage.removeItem('maintenance_token'); authToken = null; showLogin(); }
        } catch { showLogin(); }
    }

    function showLogin() { loginOverlay.style.display = 'flex'; mainContent.style.display = 'none'; }

    function showDashboard(role = localStorage.getItem('user_role')) {
        loginOverlay.style.display = 'none';
        mainContent.style.display = 'block';
        if (manageMachinesBtn) {
            if (role === 'admin') {
                manageMachinesBtn.style.display = 'inline-block';
            } else {
                manageMachinesBtn.style.display = 'none';
            }
        }
        loadStaff();
        loadReports();
        loadStats();
        connectSSE();
        initPushNotifications();
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
                localStorage.setItem('user_role', data.role);
                showDashboard(data.role);
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
        localStorage.removeItem('user_role');
        authToken = null;
        showLogin();
    });

    // ─── Monthly Reports ──────────────────────────────────────────────────
    if (monthlyReportBtn) {
        monthlyReportBtn.addEventListener('click', () => {
            monthlyModal.classList.add('visible');
            const now = new Date();
            // Format YYYY-MM
            monthSelector.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            loadMonthlyStats();
        });
    }

    if (closeMonthlyModal) closeMonthlyModal.addEventListener('click', () => monthlyModal.classList.remove('visible'));
    if (fetchMonthlyBtn) fetchMonthlyBtn.addEventListener('click', loadMonthlyStats);

    async function loadMonthlyStats() {
        if (!monthSelector.value) return;
        const [year, month] = monthSelector.value.split('-');
        monthlyStatsContainer.innerHTML = '<div style="text-align:center; padding: 20px;">Loading...</div>';

        try {
            const res = await fetch(`/api/stats/monthly?year=${year}&month=${month}`, { headers: authHeaders() });
            const data = await res.json();

            if (!data.data || data.data.length === 0) {
                monthlyStatsContainer.innerHTML = `<div class="empty-state"><p>No reports found for ${month}/${year}</p></div>`;
                return;
            }

            let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
            data.data.forEach(stat => {
                html += `
                    <div class="glass-card" style="padding: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-weight: 500; font-size: 0.95rem;">${escapeHtml(stat.machine_name)}</div>
                        <div style="display: flex; gap: 12px; font-size: 0.85rem; text-align: right;">
                            <div>Total:<br><strong>${stat.total_reports}</strong></div>
                            <div style="color: var(--accent-green);">Resolved:<br><strong>${stat.resolved_reports}</strong></div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            monthlyStatsContainer.innerHTML = html;
        } catch {
            monthlyStatsContainer.innerHTML = `<div class="empty-state" style="color:var(--accent-red)"><p>Failed to load data</p></div>`;
        }
    }

    // ─── Manage Machines ────────────────────────────────────────────────────
    if (manageMachinesBtn) {
        manageMachinesBtn.addEventListener('click', () => {
            manageMachinesModal.classList.add('visible');
            loadManageMachinesList();
        });
    }

    if (closeManageMachinesModal) {
        closeManageMachinesModal.addEventListener('click', () => {
            manageMachinesModal.classList.remove('visible');
        });
    }

    async function loadManageMachinesList() {
        manageMachinesList.innerHTML = '<div style="text-align:center; padding: 20px;">Loading machines...</div>';
        try {
            const res = await fetch('/api/machines', { headers: authHeaders() });
            const machines = await res.json();

            if (machines.length === 0) {
                manageMachinesList.innerHTML = `<div class="empty-state"><p>No machines found</p></div>`;
                return;
            }

            let html = '';
            machines.forEach(machine => {
                html += `
                    <div class="glass-card" style="padding: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 500; font-size: 0.95rem;">${escapeHtml(machine.name)}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted);">📍 ${escapeHtml(machine.location)} · ${escapeHtml(machine.department)}</div>
                        </div>
                        <button class="btn-delete-machine" data-id="${machine.id}" data-name="${escapeHtml(machine.name)}" 
                                style="background: none; border: none; color: var(--accent-red); cursor: pointer; font-size: 1.2rem; padding: 4px;">
                            🗑️
                        </button>
                    </div>
                `;
            });
            manageMachinesList.innerHTML = html;

            manageMachinesList.querySelectorAll('.btn-delete-machine').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    const name = e.currentTarget.getAttribute('data-name');
                    if (confirm(`Are you sure you want to delete machine "${name}"?\nAll associated reports will also be deleted. This cannot be undone.`)) {
                        try {
                            const delRes = await fetch(`/api/machines/${id}`, {
                                method: 'DELETE',
                                headers: authHeaders()
                            });
                            if (delRes.ok) {
                                showToast(`🗑️ ${name} deleted`, 'success');
                                loadManageMachinesList();
                                // Reload reports and stats since deleting a machine deletes its reports
                                loadReports();
                                loadStats();
                            } else {
                                showToast('Failed to delete machine', 'error');
                            }
                        } catch {
                            showToast('Network error', 'error');
                        }
                    }
                });
            });
        } catch {
            manageMachinesList.innerHTML = `<div class="empty-state" style="color:var(--accent-red)"><p>Failed to load machines</p></div>`;
        }
    }

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

        eventSource.addEventListener('report_deleted', (e) => {
            const deleted = JSON.parse(e.data);
            allReports = allReports.filter(r => r.id !== deleted.id);
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

    // ─── Web Push API ────────────────────────────────────────────────────────
    async function initPushNotifications() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        try {
            const registration = await navigator.serviceWorker.register('/sw.js');

            // Wait for service worker to be ready
            await navigator.serviceWorker.ready;

            // Check if already subscribed
            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                // Not subscribed, get the public key from our server
                const res = await fetch('/api/vapidPublicKey', { headers: authHeaders() });
                const { publicKey } = await res.json();

                const convertedVapidKey = urlBase64ToUint8Array(publicKey);

                // Subscribe to push manager (this triggers the browser prompt)
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedVapidKey
                });

                // Send the new subscription to our backend to save it
                await fetch('/api/subscribe', {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(subscription)
                });
                console.log('Push notifications subscribed and registered with server.');
            }
        } catch (error) {
            console.error('Push notification registration failed:', error);
        }
    }

    // Helper function for VAPID key conversion
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
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
        reportsList.querySelectorAll('[data-delete-report]').forEach(btn => {
            btn.addEventListener('click', () => deleteReport(btn.dataset.deleteReport));
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

        const userRole = localStorage.getItem('user_role');
        if (userRole === 'admin') {
            actions += `<button class="btn btn-ghost btn-sm" data-delete-report="${report.id}" style="color: var(--accent-red); margin-left: 4px;" title="Delete Report">🗑️</button>`;
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

    async function deleteReport(reportId) {
        if (!confirm(`Are you sure you want to delete report #${reportId}? This cannot be undone.`)) return;
        try {
            const res = await fetch(`/api/reports/${reportId}`, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (res.ok) {
                showToast(`Report #${reportId} deleted 🗑️`, 'success');
                // The SSE event 'report_deleted' will remove it from the UI automatically, or we can reload
            } else {
                showToast('Failed to delete report', 'error');
            }
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

        // Return full date and time details instead of just "Xh ago" or "Xm ago" for better visibility requested by user
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
