document.addEventListener('DOMContentLoaded', () => {
    const reportsList = document.getElementById('reportsList');
    const emptyState = document.getElementById('emptyState');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionText = document.getElementById('connectionText');
    const alertSound = document.getElementById('alertSound');

    let allReports = [];
    let currentFilter = 'all';
    let isFirstLoad = true;

    // ─── Load initial data ──────────────────────────────────────────────────
    loadReports();
    loadStats();

    // ─── SSE connection ─────────────────────────────────────────────────────
    let eventSource;

    function connectSSE() {
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
            showToast(`🚨 New report: ${report.machine_name} — ${report.error_message}`, 'error');
        });

        eventSource.addEventListener('report_updated', (e) => {
            const updated = JSON.parse(e.data);
            const index = allReports.findIndex(r => r.id === updated.id);
            if (index !== -1) {
                allReports[index] = updated;
            }
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

    connectSSE();

    // ─── Filter tabs ────────────────────────────────────────────────────────
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderReports();
        });
    });

    // ─── Load reports ───────────────────────────────────────────────────────
    async function loadReports() {
        try {
            const res = await fetch('/api/reports');
            allReports = await res.json();
            isFirstLoad = false;
            renderReports();
        } catch (err) {
            showToast('Failed to load reports', 'error');
        }
    }

    // ─── Load stats ─────────────────────────────────────────────────────────
    async function loadStats() {
        try {
            const res = await fetch('/api/stats');
            const stats = await res.json();
            document.getElementById('statCritical').textContent = stats.critical_open || 0;
            document.getElementById('statOpen').textContent = stats.open_count || 0;
            document.getElementById('statInProgress').textContent = stats.in_progress_count || 0;
            document.getElementById('statResolved').textContent = stats.resolved_count || 0;
        } catch (err) {
            // Silent fail
        }
    }

    // ─── Render reports ─────────────────────────────────────────────────────
    function renderReports() {
        const filtered = currentFilter === 'all'
            ? allReports
            : allReports.filter(r => r.status === currentFilter);

        if (filtered.length === 0) {
            reportsList.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        reportsList.innerHTML = filtered.map((r, i) => createReportCard(r, i === 0 && !isFirstLoad)).join('');

        // Attach event listeners for action buttons
        reportsList.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const reportId = btn.dataset.reportId;
                const action = btn.dataset.action;
                updateReportStatus(reportId, action);
            });
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

        let actions = '';
        if (report.status === 'open') {
            actions = `<button class="btn btn-warning btn-sm" data-action="in_progress" data-report-id="${report.id}">🔧 Take Ownership</button>`;
        } else if (report.status === 'in_progress') {
            actions = `<button class="btn btn-success btn-sm" data-action="resolved" data-report-id="${report.id}">✅ Mark Resolved</button>`;
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
        <div class="report-footer">
          <div>${priorityBadge} ${statusBadge}</div>
          <div class="report-actions">${actions}</div>
        </div>
        ${resolvedInfo}
        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:8px;">Reported by: ${escapeHtml(report.reported_by || 'Operator')}</div>
      </div>
    `;
    }

    // ─── Update report status ──────────────────────────────────────────────
    async function updateReportStatus(reportId, newStatus) {
        const resolverName = newStatus === 'in_progress' ?
            prompt('Enter your name (maintenance):') : null;

        try {
            const res = await fetch(`/api/reports/${reportId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    resolved_by: resolverName || 'Maintenance',
                }),
            });

            if (res.ok) {
                showToast(`Report #${reportId} updated to ${formatStatus(newStatus)}`, 'success');
            } else {
                showToast('Failed to update status', 'error');
            }
        } catch (err) {
            showToast('Network error', 'error');
        }
    }

    // ─── Play alert sound ──────────────────────────────────────────────────
    function playAlertSound() {
        try {
            // Create a simple beep using Web Audio API
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.frequency.value = 880;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.3;

            oscillator.start();
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            oscillator.stop(ctx.currentTime + 0.5);

            // Second beep
            setTimeout(() => {
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.frequency.value = 1100;
                osc2.type = 'sine';
                gain2.gain.value = 0.3;
                osc2.start();
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                osc2.stop(ctx.currentTime + 0.5);
            }, 200);
        } catch (e) {
            // Fallback: try playing the audio element
            alertSound.play().catch(() => { });
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────
    function formatTime(dateStr) {
        const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
        const now = new Date();
        const diff = (now - d) / 1000;

        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    function formatStatus(status) {
        return status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

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
