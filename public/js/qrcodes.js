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

    // ─── Auth check ─────────────────────────────────────────────────────────
    checkAuth();

    async function checkAuth() {
        if (!authToken) return showLogin();

        try {
            const res = await fetch('/api/auth/check', {
                headers: { 'x-auth-token': authToken },
            });
            const data = await res.json();
            if (data.authenticated) {
                showMain();
            } else {
                localStorage.removeItem('maintenance_token');
                authToken = null;
                showLogin();
            }
        } catch {
            showLogin();
        }
    }

    function showLogin() {
        loginOverlay.style.display = 'flex';
        mainContent.style.display = 'none';
    }

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
                showMain();
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
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'x-auth-token': authToken },
            });
        } catch { }
        localStorage.removeItem('maintenance_token');
        authToken = null;
        showLogin();
    });

    // ─── Load machines and their QR codes ───────────────────────────────────
    async function loadMachines() {
        try {
            const res = await fetch('/api/machines', {
                headers: { 'x-auth-token': authToken },
            });
            const machines = await res.json();

            if (machines.length === 0) {
                qrGrid.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🏭</div>
            <h3>No machines yet</h3>
            <p>Add your first machine to generate a QR code</p>
          </div>
        `;
                return;
            }

            // Fetch QR codes for all machines in parallel
            const qrPromises = machines.map(async (machine) => {
                try {
                    const qrRes = await fetch(`/api/machines/${machine.id}/qrcode`, {
                        headers: { 'x-auth-token': authToken },
                    });
                    const qrData = await qrRes.json();
                    return { machine, qrData };
                } catch (err) {
                    return { machine, qrData: null };
                }
            });

            const results = await Promise.all(qrPromises);

            qrGrid.innerHTML = results.map(({ machine, qrData }) => {
                const qrSvg = qrData && qrData.qr_svg
                    ? qrData.qr_svg
                    : '<div style="padding:40px; color:var(--text-muted);">QR Error</div>';

                return `
          <div class="glass-card qr-card">
            <div class="qr-image">${qrSvg}</div>
            <div class="machine-name">${escapeHtml(machine.name)}</div>
            <div class="machine-loc">📍 ${escapeHtml(machine.location)} · ${escapeHtml(machine.department)}</div>
            <div style="margin-top: 8px;">
              <span style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace;">ID: ${machine.id}</span>
            </div>
          </div>
        `;
            }).join('');

        } catch (err) {
            qrGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <h3>Failed to load</h3>
          <p>Could not connect to the server</p>
        </div>
      `;
        }
    }

    // ─── Add Machine Modal ──────────────────────────────────────────────────
    addMachineBtn.addEventListener('click', () => {
        addMachineModal.classList.add('visible');
    });

    cancelAddMachine.addEventListener('click', () => {
        addMachineModal.classList.remove('visible');
        addMachineForm.reset();
    });

    addMachineForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('newMachineName').value.trim();
        const location = document.getElementById('newMachineLocation').value.trim();
        const department = document.getElementById('newMachineDept').value.trim() || 'General';

        if (!name || !location) {
            showToast('Name and location are required', 'error');
            return;
        }

        try {
            const res = await fetch('/api/machines', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
                body: JSON.stringify({ name, location, department }),
            });

            if (res.ok) {
                showToast(`✅ ${name} added successfully!`, 'success');
                addMachineModal.classList.remove('visible');
                addMachineForm.reset();
                loadMachines();
            } else {
                showToast('Failed to add machine', 'error');
            }
        } catch (err) {
            showToast('Network error', 'error');
        }
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
