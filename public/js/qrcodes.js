document.addEventListener('DOMContentLoaded', () => {
    const qrGrid = document.getElementById('qrGrid');
    const addMachineBtn = document.getElementById('addMachineBtn');
    const addMachineModal = document.getElementById('addMachineModal');
    const cancelAddMachine = document.getElementById('cancelAddMachine');
    const addMachineForm = document.getElementById('addMachineForm');

    // ─── Load machines and their QR codes ───────────────────────────────────
    loadMachines();

    async function loadMachines() {
        try {
            const res = await fetch('/api/machines');
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
                    const qrRes = await fetch(`/api/machines/${machine.id}/qrcode`);
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
                headers: { 'Content-Type': 'application/json' },
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
