document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const machineId = params.get('machine_id');

    const machineInfoBar = document.getElementById('machineInfoBar');
    const machineSelectGroup = document.getElementById('machineSelectGroup');
    const machineSelect = document.getElementById('machineSelect');
    const machineName = document.getElementById('machineName');
    const machineLocation = document.getElementById('machineLocation');
    const reportForm = document.getElementById('reportForm');
    const submitBtn = document.getElementById('submitBtn');
    const photoInput = document.getElementById('photoInput');
    const photoPreview = document.getElementById('photoPreview');
    const photoPreviewImg = document.getElementById('photoPreviewImg');
    const successOverlay = document.getElementById('successOverlay');
    const ticketNumber = document.getElementById('ticketNumber');
    const newReportBtn = document.getElementById('newReportBtn');

    let selectedMachineId = machineId;

    // ─── Load machine from QR scan or list ──────────────────────────────────
    if (machineId) {
        // QR scan — fetch machine info and show the info bar
        try {
            const res = await fetch(`/api/machines/${machineId}/info`);
            if (res.ok) {
                const machine = await res.json();
                machineName.textContent = machine.name;
                machineLocation.textContent = `${machine.location} · ${machine.department}`;
                machineInfoBar.style.display = 'flex';
                machineSelectGroup.style.display = 'none';
                machineSelect.removeAttribute('required');
            } else {
                showToast('Machine not found — please select manually', 'error');
                await loadMachineList();
            }
        } catch (err) {
            showToast('Could not load machine info', 'error');
            await loadMachineList();
        }
    } else {
        // No QR scan — show machine dropdown
        await loadMachineList();
    }

    async function loadMachineList() {
        machineSelectGroup.style.display = 'block';
        machineInfoBar.style.display = 'none';
        try {
            const res = await fetch('/api/machines/list');
            const machines = await res.json();
            machines.forEach(m => {
                const option = document.createElement('option');
                option.value = m.id;
                option.textContent = `${m.name} — ${m.location}`;
                machineSelect.appendChild(option);
            });
        } catch (err) {
            showToast('Failed to load machines', 'error');
        }
    }

    // Update selectedMachineId when dropdown changes
    machineSelect.addEventListener('change', (e) => {
        selectedMachineId = e.target.value;
    });

    // ─── Photo preview ──────────────────────────────────────────────────────
    photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                photoPreviewImg.src = ev.target.result;
                photoPreview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        } else {
            photoPreview.style.display = 'none';
        }
    });

    // ─── Form submission ────────────────────────────────────────────────────
    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!selectedMachineId) {
            showToast('Please select a machine', 'error');
            return;
        }

        const errorMessage = document.getElementById('errorMessage').value.trim();
        if (!errorMessage) {
            showToast('Please enter the error message', 'error');
            return;
        }

        // Show loading state
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;

        const formData = new FormData();
        formData.append('machine_id', selectedMachineId);
        formData.append('error_message', errorMessage);
        formData.append('description', document.getElementById('description').value.trim());
        formData.append('priority', document.querySelector('input[name="priority"]:checked').value);
        formData.append('reported_by', document.getElementById('operatorName').value.trim() || 'Operator');

        const photoFile = photoInput.files[0];
        if (photoFile) {
            formData.append('photo', photoFile);
        }

        try {
            const res = await fetch('/api/reports', {
                method: 'POST',
                body: formData,
            });

            if (res.ok) {
                const report = await res.json();
                ticketNumber.textContent = `Ticket #${report.id}`;
                successOverlay.classList.add('visible');

                // Vibrate if supported (mobile)
                if (navigator.vibrate) navigator.vibrate(200);
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to submit report', 'error');
            }
        } catch (err) {
            showToast('Network error — please try again', 'error');
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    });

    // ─── New Report ─────────────────────────────────────────────────────────
    newReportBtn.addEventListener('click', () => {
        successOverlay.classList.remove('visible');
        reportForm.reset();
        photoPreview.style.display = 'none';
        document.getElementById('priorityMedium').checked = true;
    });

    // ─── Toast ──────────────────────────────────────────────────────────────
    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} visible`;
        setTimeout(() => toast.classList.remove('visible'), 3000);
    }
});
