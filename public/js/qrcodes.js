document.addEventListener('DOMContentLoaded', () => {
    const qrGrid = document.getElementById('qrGrid');
    const addMachineBtn = document.getElementById('addMachineBtn');
    const addMachineModal = document.getElementById('addMachineModal');
    const cancelAddMachine = document.getElementById('cancelAddMachine');
    const addMachineForm = document.getElementById('addMachineForm');
    const loginOverlay = document.getElementById('loginOverlay');
    const mainContent = document.getElementById('mainContent');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const logoutBtn = document.getElementById('logoutBtn');

    let authToken = localStorage.getItem('maintenance_token');

    // ─── Auth ───────────────────────────────────────────────────────────────
    checkAuth();

    async function checkAuth() {
        if (!authToken) return showLogin();
        try {
            const res = await fetch('/api/auth/check', { headers: { 'x-auth-token': authToken } });
            const data = await res.json();
            if (data.authenticated) {
                localStorage.setItem('user_role', data.role);
                showMain();
            }
            else { localStorage.removeItem('maintenance_token'); authToken = null; showLogin(); }
        } catch { showLogin(); }
    }

    function showLogin() { loginOverlay.style.display = 'flex'; mainContent.style.display = 'none'; }

    function showMain() {
        loginOverlay.style.display = 'none';
        mainContent.style.display = 'block';
        loadMachines();
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
                showMain();
            } else {
                loginError.textContent = '❌ Invalid PIN.';
                loginError.style.display = 'block';
                document.getElementById('pinInput').value = '';
                document.getElementById('pinInput').focus();
            }
        } catch {
            loginError.textContent = '❌ Connection error.';
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

    // ─── Load machines and QR codes ─────────────────────────────────────────
    async function loadMachines() {
        try {
            const res = await fetch('/api/machines', { headers: { 'x-auth-token': authToken } });
            const machines = await res.json();

            if (machines.length === 0) {
                qrGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">🏭</div><h3>No machines yet</h3></div>';
                return;
            }

            const qrPromises = machines.map(async (machine) => {
                try {
                    const qrRes = await fetch(`/api/machines/${machine.id}/qrcode`, { headers: { 'x-auth-token': authToken } });
                    const qrData = await qrRes.json();
                    return { machine, qrData };
                } catch { return { machine, qrData: null }; }
            });

            const results = await Promise.all(qrPromises);
            const userRole = localStorage.getItem('user_role');

            qrGrid.innerHTML = results.map(({ machine, qrData }) => {
                const qrSvg = qrData?.qr_svg || '<div style="padding:40px; color:var(--text-muted);">QR Error</div>';
                return `
          <div class="glass-card qr-card">
            <div class="qr-image">${qrSvg}</div>
            <div class="machine-name">${escapeHtml(machine.name)}</div>
            <div class="machine-loc">📍 ${escapeHtml(machine.location)} · ${escapeHtml(machine.department)}</div>
            <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace;">ID: ${machine.id}</span>
              ${userRole === 'admin' ? `<button class="btn-delete-machine no-print" data-id="${machine.id}" data-name="${escapeHtml(machine.name)}" style="background: none; border: none; color: var(--accent-red); cursor: pointer; font-size: 0.8rem;">🗑️ Delete</button>` : ''}
            </div>
          </div>
        `;
            }).join('');

            document.querySelectorAll('.btn-delete-machine').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.target.getAttribute('data-id');
                    const name = e.target.getAttribute('data-name');
                    if (confirm(`Are you sure you want to delete machine "${name}"?\nAll associated reports will also be deleted. This cannot be undone.`)) {
                        try {
                            const res = await fetch(`/api/machines/${id}`, {
                                method: 'DELETE',
                                headers: { 'x-auth-token': authToken }
                            });
                            if (res.ok) {
                                showToast(`🗑️ ${name} deleted`, 'success');
                                loadMachines();
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
            qrGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><h3>Failed to load</h3></div>';
        }
    }

    // ─── Add Machine Modal ──────────────────────────────────────────────────
    addMachineBtn.addEventListener('click', () => addMachineModal.classList.add('visible'));
    cancelAddMachine.addEventListener('click', () => { addMachineModal.classList.remove('visible'); addMachineForm.reset(); });

    addMachineForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('newMachineName').value.trim();
        const location = document.getElementById('newMachineLocation').value.trim();
        const department = document.getElementById('newMachineDept').value.trim() || 'General';
        if (!name || !location) { showToast('Name and location required', 'error'); return; }

        try {
            const res = await fetch('/api/machines', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                body: JSON.stringify({ name, location, department }),
            });
            if (res.ok) {
                showToast(`✅ ${name} added!`, 'success');
                addMachineModal.classList.remove('visible');
                addMachineForm.reset();
                loadMachines();
            } else showToast('Failed to add', 'error');
        } catch { showToast('Network error', 'error'); }
    });

    // ─── Helpers ────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} visible`;
        setTimeout(() => toast.classList.remove('visible'), 3000);
    }
});
