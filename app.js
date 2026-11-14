/**
 * Employee CMS - Real Supabase Authentication, Payroll Engine,
 * Safeguards & Dispute Resolution Queue
 */

// ⚠️ PASTE YOUR VALUES HERE — the anon/public key is safe to be public.
const SUPABASE_URL = 'https://tzrzriwurhnhykcaddbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6cnpyaXd1cmhuaHlrY2FkZGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODg4MTEsImV4cCI6MjExMDE2NDgxMX0.z7sE9oSo7_8uMoW92AOiT7MwZxAyYAVhOzrAwT1rdzM';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null; // Holds { id, email, full_name, role }

// ---------------------------------------------------------------------------
// On page load: check for an active Supabase auth session
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await loadProfileAndEnterApp(session.user.id);
  }
});

// ---------------------------------------------------------------------------
// Authentication Handlers
// ---------------------------------------------------------------------------
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorBox = document.getElementById('login-error');
  if (errorBox) {
    errorBox.style.display = 'none';
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    showLoginError(error.message);
    return;
  }

  await loadProfileAndEnterApp(data.user.id);
}

async function loadProfileAndEnterApp(userId) {
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('id, email, full_name, role, zk_user_id')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    showLoginError('Could not load your profile. Please contact HR/Admin.');
    await supabaseClient.auth.signOut();
    return;
  }

  currentUser = profile;
  enterApp(profile);
}

function showLoginError(message) {
  const errorBox = document.getElementById('login-error');
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  } else {
    alert(message);
  }
}

// Dedicated function to handle tab visibility and switching
function updateNavigationForUser(role) {
  const tabSales = document.getElementById('tab-sales');
  const tabOps = document.getElementById('tab-ops');
  const tabHr = document.getElementById('tab-hr');
  const tabDirectory = document.getElementById('tab-directory'); // ⬅️ NEW
  const tabRecruitment = document.getElementById('tab-recruitment');

  if (!tabSales || !tabOps || !tabHr) return;

  if (role === 'sales') {
    tabSales.style.display = 'inline-block';
    tabOps.style.display = 'none';
    tabHr.style.display = 'none';
    if (tabDirectory) tabDirectory.style.display = 'none';
    if (tabRecruitment) tabRecruitment.style.display = 'none';
    switchPortal('sales');
  } else if (role === 'operations') {
    tabSales.style.display = 'none';
    tabOps.style.display = 'inline-block';
    tabHr.style.display = 'none';
    if (tabDirectory) tabDirectory.style.display = 'none';
    if (tabRecruitment) tabRecruitment.style.display = 'none';
    switchPortal('ops');
  } else if (role === 'hr') {
    tabSales.style.display = 'none';
    tabOps.style.display = 'none';
    tabHr.style.display = 'inline-block';
    if (tabDirectory) tabDirectory.style.display = 'inline-block'; // ⬅️ Show for HR
    if (tabRecruitment) tabRecruitment.style.display = 'inline-block';
    switchPortal('hr');
  } else if (role === 'admin') {
    tabSales.style.display = 'inline-block';
    tabOps.style.display = 'inline-block';
    tabHr.style.display = 'inline-block';
    if (tabDirectory) tabDirectory.style.display = 'inline-block'; // ⬅️ Show for Admin
    if (tabRecruitment) tabRecruitment.style.display = 'inline-block';
    switchPortal('hr');
  }
}
// Main application entry function
function enterApp(profile) {
  // Update user details in header
  document.getElementById('logged-user-name').textContent = profile.full_name || profile.email;
  document.getElementById('logged-user-role').textContent = roleLabel(profile.role);

  // Toggle UI screens
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';

  // Delegate navigation & view management
  updateNavigationForUser(profile.role);

  if (isRecruitmentUser()) setupRecruitmentRealtimeSync();
}
async function handleLogout() {
  if (recruitmentRealtimeChannel) {
    supabaseClient.removeChannel(recruitmentRealtimeChannel);
    recruitmentRealtimeChannel = null;
  }
  if (candidateChatRealtimeChannel) {
    supabaseClient.removeChannel(candidateChatRealtimeChannel);
    candidateChatRealtimeChannel = null;
  }
  candidateChatId = null;

  await supabaseClient.auth.signOut();
  currentUser = null;
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('login-form').reset();
}

function switchPortal(portalId) {
  document.querySelector('main.container')?.classList.toggle('recruitment-layout', portalId === 'recruitment');
  document.querySelectorAll('.portal-section').forEach(sec => sec.style.display = 'none');
  document.querySelectorAll('.role-btn').forEach(btn => btn.classList.remove('active'));

  if (portalId === 'sales') {
    document.getElementById('sales-portal').style.display = 'block';
    document.getElementById('tab-sales')?.classList.add('active');
    loadSalesPortalData();
    loadEmployeeApplicationsStatus();
  } else if (portalId === 'ops') {
    document.getElementById('ops-portal').style.display = 'block';
    document.getElementById('tab-ops')?.classList.add('active');
    loadOpsPortalData();
  } else if (portalId === 'hr') {
    document.getElementById('hr-portal').style.display = 'block';
    document.getElementById('tab-hr')?.classList.add('active');
    loadHrPortalData();
    loadTeamMatrixData(); // <--- Moved here from Ops: HR now owns Corporate Identity & Compensation
  } else if (portalId === 'recruitment') {
    // Defense in depth: RLS is the real gate, this just keeps the UI honest.
    if (!isRecruitmentUser()) return;
    document.getElementById('recruitment-portal').style.display = 'block';
    document.getElementById('tab-recruitment')?.classList.add('active');
    setupRecruitmentRealtimeSync();
    loadCandidatesData();
  } else if (portalId === 'directory') {
    document.getElementById('directory-portal').style.display = 'block';
    document.getElementById('tab-directory')?.classList.add('active');
    loadEmployeeDirectoryData();
  }
}

let rawDirectoryEmployees = []; // Global memory store for instant local search/filtering

async function loadEmployeeDirectoryData() {
  const gridView = document.getElementById('directory-grid-view');
  if (!gridView) return;

  gridView.innerHTML = '<p style="color: #64748b; grid-column: 1/-1;">Loading employee directory...</p>';

  try {
    const { data: profiles, error } = await supabaseClient
      .from('profiles')
      .select('id, full_name, email, role, avatar_url, phone, mobile_number')
      .order('full_name', { ascending: true });

    if (error) throw error;

    rawDirectoryEmployees = profiles || [];
    renderEmployeeDirectory(rawDirectoryEmployees);

  } catch (err) {
    console.error("Directory fetch error:", err);
    gridView.innerHTML = `<p style="color: #ef4444; grid-column: 1/-1;">Failed to load directory: ${escapeHtml(err.message)}</p>`;
  }
}

function renderEmployeeDirectory(employees) {
  const gridView = document.getElementById('directory-grid-view');
  const tableBody = document.getElementById('directory-table-body');

  if (!gridView || !tableBody) return;

  gridView.innerHTML = '';
  tableBody.innerHTML = '';

  if (employees.length === 0) {
    gridView.innerHTML = '<p style="color: #94a3b8; grid-column: 1/-1; text-align: center;">No matching employees found.</p>';
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 1rem;">No matching employees found.</td></tr>';
    return;
  }

  const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='%23cbd5e1'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

  employees.forEach(emp => {
    const cleanName = escapeHtml(emp.full_name || 'Unnamed Staff');
    const cleanEmail = escapeHtml(emp.email || '--');
    const cleanPhone = escapeHtml(emp.mobile_number || emp.phone || 'No phone recorded');
    const displayRole = roleLabel(emp.role);
    const avatar = emp.avatar_url ? `${emp.avatar_url}?t=${Date.now()}` : defaultAvatar;

    // 1. Grid Card Item
    const card = document.createElement('div');
    card.style.cssText = 'background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; align-items: center; text-align: center;';
    card.innerHTML = `
      <img src="${avatar}" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 2px solid #cbd5e1; margin-bottom: 0.75rem;" alt="${cleanName}">
      <h3 style="margin: 0; font-size: 1rem; color: #0f172a;">${cleanName}</h3>
      <span class="badge assigned" style="margin: 0.4rem 0 0.75rem 0;">${displayRole}</span>
      <p style="margin: 0; font-size: 0.825rem; color: #64748b; word-break: break-all;">${cleanEmail}</p>
      <p style="margin: 0.25rem 0 1rem 0; font-size: 0.8rem; color: #94a3b8;">${cleanPhone}</p>
     <button class="btn-secondary" onclick="openPersonalInfoModal('${emp.id}')">
  View Profile
</button>
    `;
    gridView.appendChild(card);

    // 2. Table Row Item
    const row = document.createElement('tr');
    row.style.borderBottom = '1px solid #e2e8f0';
    row.innerHTML = `
      <td style="padding: 10px 12px; display: flex; align-items: center; gap: 0.75rem;">
        <img src="${avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;" alt="${cleanName}">
        <strong>${cleanName}</strong>
      </td>
      <td style="padding: 10px 12px; color: #475569;">${cleanEmail}</td>
      <td style="padding: 10px 12px;"><span class="badge assigned">${displayRole}</span></td>
      <td style="padding: 10px 12px; text-align: right;">
        <button class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="openEmployeeCalendar('${emp.id}', '${cleanName.replace(/'/g, "\\'")}')">Inspect Logs</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
}

function filterEmployeeDirectory() {
  const searchTerm = (document.getElementById('directory-search')?.value || '').toLowerCase().trim();
  const selectedRole = document.getElementById('directory-role-filter')?.value || 'all';

  const filtered = rawDirectoryEmployees.filter(emp => {
    const matchesSearch = (emp.full_name || '').toLowerCase().includes(searchTerm) ||
      (emp.email || '').toLowerCase().includes(searchTerm);
    const matchesRole = selectedRole === 'all' || emp.role === selectedRole;

    return matchesSearch && matchesRole;
  });

  renderEmployeeDirectory(filtered);
}

function toggleDirectoryView(mode) {
  const gridContainer = document.getElementById('directory-grid-view');
  const tableContainer = document.getElementById('directory-table-view');
  const gridBtn = document.getElementById('view-btn-grid');
  const tableBtn = document.getElementById('view-btn-table');

  if (mode === 'grid') {
    gridContainer.style.display = 'grid';
    tableContainer.style.display = 'none';
    gridBtn.style.background = '#ffffff';
    tableBtn.style.background = 'transparent';
  } else {
    gridContainer.style.display = 'none';
    tableContainer.style.display = 'block';
    gridBtn.style.background = 'transparent';
    tableBtn.style.background = '#ffffff';
  }
}

// ---------------------------------------------------------------------------
// Sales & Operations Portal Handlers
// ---------------------------------------------------------------------------
function updateIncentivePreview() {
  const usdInput = parseFloat(document.getElementById('deal-usd').value) || 0;
  const pkrIncentive = (usdInput * 75).toLocaleString('en-US');
  document.getElementById('preview-pkr').textContent = `${pkrIncentive} PKR`;
}

async function handleLeadSubmit(e) {
  e.preventDefault();

  const clientName = document.getElementById('client-name').value.trim();
  const clientEmail = document.getElementById('client-email').value.trim();
  const clientPhone = document.getElementById('client-phone').value.trim();
  const dealUsd = parseFloat(document.getElementById('deal-usd').value);
  const notes = document.getElementById('qual-notes').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking for duplicates...';

  try {
    const { data: dupCheck, error: dupError } = await supabaseClient
      .rpc('check_duplicate_lead', {
        p_email: clientEmail,
        p_phone: clientPhone
      });

    if (dupError) {
      alert('Error checking for duplicates: ' + dupError.message);
      return;
    }

    if (dupCheck && dupCheck.length > 0 && dupCheck[0].is_duplicate) {
      alert(`This client already exists in the system as "${dupCheck[0].existing_client_name}".`);
      return;
    }

    submitBtn.textContent = 'Submitting...';
    const { error: insertError } = await supabaseClient
      .from('sales_leads')
      .insert({
        submitted_by: currentUser.id,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        deal_value_usd: dealUsd,
        qualification_notes: notes,
        status: 'new'
      });

    if (insertError) {
      alert('Error submitting lead: ' + insertError.message);
      return;
    }

    alert(`Lead "${clientName}" submitted successfully.`);
    document.getElementById('lead-form').reset();
    document.getElementById('preview-pkr').textContent = '0 PKR';

    // Refresh local Sales context
    await loadSalesPortalData();
    // Refresh Operations context immediately if visible
    if (typeof loadOpsPortalData === 'function') {
      await loadOpsPortalData();
    }

  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'SUBMIT LEAD TO OPERATIONS QUEUE';
  }
}

const LEAD_STAGES = ['new', 'assigned', 'in_progress', 'proposal_sent', 'closed_won', 'closed_lost'];

// ---------------------------------------------------------------------------
// Core Operational Metrics Framework Queue
// ---------------------------------------------------------------------------
async function loadOpsPortalData() {
  const activeCountEl = document.getElementById('ops-active-count');
  const complianceEl = document.getElementById('ops-sla-compliance');
  const breachCountEl = document.getElementById('ops-breach-count');
  const queueBody = document.getElementById('ops-queue-body');

  try {
    // FIXED: the old query had a stray `.select(...)` string nested inside
    // the template literal, which meant none of the fields used below
    // (submitter, deal_value_usd, created_at) were actually being fetched.
    const { data: leads, error } = await supabaseClient
      .from('sales_leads')
      .select(`
        id, client_name, status, deal_value_usd, created_at,
        submitter:profiles!sales_leads_submitted_by_fkey(full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!queueBody) return;

    queueBody.innerHTML = '';

    if (!leads || leads.length === 0) {
      queueBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No leads currently in the operational queue.</td></tr>';
      if (activeCountEl) activeCountEl.textContent = '0';
      if (complianceEl) complianceEl.textContent = '100%';
      if (breachCountEl) breachCountEl.textContent = '0';
      return;
    }

    let activeCount = 0;
    let breachedCount = 0;
    const now = new Date();

    leads.forEach(lead => {
      if (lead.status !== 'closed_won' && lead.status !== 'closed_lost') {
        activeCount++;
      }

      // Calculate simple 2-hour SLA boundary window from database log
      const createdAt = new Date(lead.created_at);
      const hoursElapsed = (now - createdAt) / (1000 * 60 * 60);
      const isBreached = hoursElapsed > 2 && (lead.status === 'new' || lead.status === 'assigned' || lead.status === 'in_progress');

      if (isBreached) {
        breachedCount++;
      }

      let slaText = '--';
      let slaClass = '';
      if (isBreached) {
        const minsPast = Math.floor((hoursElapsed - 2) * 60);
        slaText = `BREACHED (+${minsPast}m)`;
        slaClass = 'style="color: var(--accent-red); font-weight: bold;"';
      } else if (lead.status === 'new' || lead.status === 'assigned' || lead.status === 'in_progress') {
        const minsLeft = Math.floor((2 - hoursElapsed) * 60);
        slaText = `${minsLeft}m remaining`;
      }

      const clientName = escapeHtml(lead.client_name);
      const repName = lead.submitter ? escapeHtml(lead.submitter.full_name) : 'System';
      const dealValue = `$${parseFloat(lead.deal_value_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const currentStage = lead.status || 'new';

      const row = document.createElement('tr');
      if (isBreached) {
        row.style.backgroundColor = 'rgba(220, 38, 38, 0.03)';
      }

      row.innerHTML = `
        <td><strong>${clientName}</strong></td>
        <td>${repName}</td>
        <td>${dealValue}</td>
        <td><span ${slaClass}>${slaText}</span></td>
        <td><span class="badge assigned">${currentStage.replace('_', ' ').toUpperCase()}</span></td>
        <td>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <select id="stage-select-${lead.id}" class="form-select" style="padding: 0.3rem; margin: 0; width: 130px;">
              ${LEAD_STAGES.map(stage => `<option value="${stage}" ${currentStage === stage ? 'selected' : ''}>${stage.toUpperCase()}</option>`).join('')}
            </select>
            <button class="btn-secondary" style="padding: 0.3rem 0.6rem;" onclick="updateLeadStage('${lead.id}')">Update</button>
          </div>
        </td>
      `;
      queueBody.appendChild(row);
    });

    if (activeCountEl) activeCountEl.textContent = activeCount;
    if (breachCountEl) breachCountEl.textContent = breachedCount;
    if (complianceEl) {
      const rate = leads.length ? (((leads.length - breachedCount) / leads.length) * 100).toFixed(1) : 100;
      complianceEl.textContent = `${rate}%`;
    }

  } catch (err) {
    console.error("Operational Metrics Engine Failure:", err);
    if (queueBody) {
      queueBody.innerHTML = `<tr><td colspan="6" style="color: var(--accent-red); text-align: center;">Operational matrix exception encountered.</td></tr>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Corporate Identity & Team Roster Operations Engine
// ---------------------------------------------------------------------------
async function loadTeamMatrixData() {
  const tbody = document.getElementById('ops-team-matrix-body');
  if (!tbody) return;

  try {
    const { data: profiles, error } = await supabaseClient
      .from('profiles')
      .select('id, email, full_name, role, zk_user_id, base_salary_pkr, is_locked')
      .order('full_name', { ascending: true });

    if (error) throw error;

    tbody.innerHTML = '';

    if (!profiles || profiles.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No active profiles found.</td></tr>';
      return;
    }

    profiles.forEach(emp => {
      const salaryVal = emp.base_salary_pkr || 0;
      const cleanName = escapeHtml(emp.full_name || '');
      const cleanEmail = escapeHtml(emp.email || '');
      const zkUserId = String(emp.zk_user_id || '');
      const escapedZkUserId = escapeHtml(zkUserId);
      const displayRole = roleLabel(emp.role);

      // FIXED: this button was being built but never inserted into the row's
      // HTML before, so the Unlock control never actually rendered.
      const unlockBtn = emp.is_locked
        ? `<button class="btn-secondary" style="padding: 0.4rem 0.6rem; background: #2563eb; color:white;" onclick="unlockEmployeeProfile('${emp.id}')">Unlock Profile</button>`
        : `<span style="color: #16a34a; font-size:0.8rem;">Editable</span>`;

      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${cleanName}</strong></td>
        <td>${cleanEmail}</td>
        <td><span class="badge assigned">${displayRole}</span></td>
        <td>
          <div class="team-matrix-control">
            <input type="text" inputmode="numeric" pattern="[0-9]+" title="Enter the numeric employee ID from ZKBio." class="form-input team-matrix-zk-input" style="${zkUserId ? '' : 'border-color: #ef4444; background: #fef2f2;'}" id="zk-${emp.id}" value="${escapedZkUserId}" aria-label="ZKBio ID for ${cleanName}">
            <button class="btn-secondary" onclick="updateZkUserId('${emp.id}')">Save</button>
          </div>
        </td>
        <td>
          <div class="team-matrix-control">
            <input type="number" class="form-input team-matrix-salary-input" id="sal-${emp.id}" value="${salaryVal}" aria-label="Base salary for ${cleanName}">
            <button class="btn-secondary" onclick="updateBaseSalary('${emp.id}')">Adjust</button>
          </div>
        </td>
        <td>
          <div class="team-matrix-actions">
            ${unlockBtn}
            <button class="btn-logout" style="background: rgba(220, 38, 38, 0.05); padding: 0.4rem 0.75rem;" onclick="deactivateEmployee('${emp.id}', '${cleanName.replace(/'/g, "\\'")}')">Deactivate</button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    });

  } catch (err) {
    console.error("Team Matrix Error caught:", err);
    tbody.innerHTML = `<tr><td colspan="6" style="color: var(--accent-red); text-align: center;">Matrix rendering bypassed: ${err.message}</td></tr>`;
  }
}

async function unlockEmployeeProfile(profileId) {
  const { error } = await supabaseClient
    .from('profiles')
    .update({ is_locked: false })
    .eq('id', profileId);

  if (error) {
    alert('Failed to unlock profile: ' + error.message);
    return;
  }

  alert('Employee profile unlocked. The user can now edit their details.');
  await loadTeamMatrixData();
}

async function handleOpsCreateUser(e) {
  e.preventDefault();

  const name = document.getElementById('new-user-name').value.trim();
  const email = document.getElementById('new-user-email').value.trim();
  const role = document.getElementById('new-user-role').value;
  const salary = parseFloat(document.getElementById('new-user-salary').value) || 0;
  const zkUserId = document.getElementById('new-user-zk-id').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!/^\d+$/.test(zkUserId)) {
    alert('Enter the numeric ZKBio employee ID before provisioning.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'PROVISIONING...';

  try {
    const { data, error } = await supabaseClient.functions.invoke('provision-employee', {
      body: {
        fullName: name,
        email,
        role,
        baseSalaryPkr: salary,
        zkUserId
      }
    });

    if (error) {
      let detail = error.message || 'Account invitation failed.';
      if (error.context instanceof Response) {
        const responseText = await error.context.clone().text();
        if (responseText) {
          try {
            const responseBody = JSON.parse(responseText);
            detail = responseBody.error || detail;
          } catch {
            detail = responseText.slice(0, 500);
          }
        }
        detail = `HTTP ${error.context.status}: ${detail}`;
      }
      throw new Error(detail);
    }

    if (!data?.success) {
      throw new Error(data?.error || 'The account invitation was not confirmed.');
    }

    alert(`Account created for ${email}. Use the configured initial password to sign in.`);
    document.getElementById('ops-create-user-form').reset();
    await loadTeamMatrixData();
  } catch (err) {
    console.error('Employee account invitation failed:', err);
    alert(`Account invitation failed: ${err.message || 'Unknown error'}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'PROVISION ACCOUNT';
  }
}

async function updateZkUserId(profileId) {
  const input = document.getElementById(`zk-${profileId}`);
  const zkUserId = input.value.trim();

  if (!/^\d+$/.test(zkUserId)) {
    alert('Enter the numeric ZKBio employee ID.');
    input.focus();
    return;
  }

  const { data: matchingProfiles, error: duplicateCheckError } = await supabaseClient
    .from('profiles')
    .select('id')
    .eq('zk_user_id', zkUserId)
    .neq('id', profileId)
    .limit(1);

  if (duplicateCheckError) {
    alert(`Could not verify the ZKBio ID: ${duplicateCheckError.message}`);
    return;
  }
  if (matchingProfiles?.length) {
    alert('That ZKBio employee ID is already assigned to another profile.');
    input.focus();
    return;
  }

  const { error } = await supabaseClient
    .from('profiles')
    .update({ zk_user_id: zkUserId })
    .eq('id', profileId);

  if (error) {
    alert(`Could not save the ZKBio ID: ${error.message}`);
    return;
  }

  await loadTeamMatrixData();
}

async function updateBaseSalary(profileId) {
  const newSalary = parseFloat(document.getElementById(`sal-${profileId}`).value);
  if (isNaN(newSalary) || newSalary < 0) {
    alert('Please provide a valid compensation numeric structure.');
    return;
  }

  const { error } = await supabaseClient
    .from('profiles')
    .update({ base_salary_pkr: newSalary })
    .eq('id', profileId);

  if (error) {
    alert(`Salary upgrade calculation failed: ${error.message}`);
    return;
  }

  alert('Base compensation structural changes saved successfully.');
  await loadTeamMatrixData();
}

async function deactivateEmployee(profileId, name) {
  if (!confirm(`Are you absolutely sure you want to revoke infrastructure routing permissions for ${name}?`)) {
    return;
  }

  const { error } = await supabaseClient
    .from('profiles')
    .delete()
    .eq('id', profileId);

  if (error) {
    alert(`Deactivation mapping engine error: ${error.message}`);
    return;
  }

  alert(`Personnel profile access parameters cleared for ${name}.`);
  await loadTeamMatrixData();
}

async function updateLeadStage(leadId) {
  const select = document.getElementById(`stage-select-${leadId}`);
  const newStatus = select.value;

  const { error } = await supabaseClient
    .from('sales_leads')
    .update({ status: newStatus })
    .eq('id', leadId);

  if (error) {
    alert('Error updating lead status: ' + error.message);
    return;
  }

  await loadOpsPortalData();
}

async function loadSalesPortalData() {
  if (!currentUser) return;

  // ---------------------------------------------------------------------------
  // 1. Fetch fresh profile details from DB & update Personal Info Card
  // ---------------------------------------------------------------------------
  const { data: freshProfile } = await supabaseClient
    .from('profiles')
    .select('full_name, avatar_url, is_locked')
    .eq('id', currentUser.id)
    .single();

  // Update in-memory user object
  if (freshProfile) {
    currentUser.avatar_url = freshProfile.avatar_url;
    currentUser.is_locked = freshProfile.is_locked;
    if (freshProfile.full_name) currentUser.full_name = freshProfile.full_name;
  }

  // Bind Name
  document.getElementById('card-user-name').textContent = currentUser.full_name || currentUser.email;

  // Bind Avatar with cache-buster
  const avatarImg = document.getElementById('card-user-avatar');
  if (avatarImg && currentUser.avatar_url) {
    // Add timestamp query parameter so the browser reloads the new image immediately
    const cacheBuster = currentUser.avatar_url.includes('?')
      ? `&t=${Date.now()}`
      : `?t=${Date.now()}`;
    avatarImg.src = currentUser.avatar_url + cacheBuster;
  }

  // Bind Lock Status Badge
  const lockBadge = document.getElementById('card-lock-status');
  if (lockBadge) {
    if (currentUser.is_locked) {
      lockBadge.textContent = 'LOCKED';
      lockBadge.style.background = '#fee2e2';
      lockBadge.style.color = '#b91c1c';
    } else {
      lockBadge.textContent = 'UNLOCKED';
      lockBadge.style.background = '#dcfce7';
      lockBadge.style.color = '#15803d';
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Fetch Meetings count for current month
  // ---------------------------------------------------------------------------
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: meetings } = await supabaseClient
    .from('sales_leads')
    .select('id')
    .eq('submitted_by', currentUser.id)
    .gte('created_at', firstDay);

  document.getElementById('sales-month-meetings-count').textContent = (meetings || []).length;

  // ---------------------------------------------------------------------------
  // 3. Fetch and Render "My Submitted Leads & Ops Pipeline" Table
  // ---------------------------------------------------------------------------
  const tbody = document.getElementById('sales-leads-body');
  if (tbody) {
    const { data: leads, error } = await supabaseClient
      .from('sales_leads')
      .select('id, client_name, status')
      .eq('submitted_by', currentUser.id)
      .order('created_at', { ascending: false });

    if (!error && leads) {
      tbody.innerHTML = '';

      if (leads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 15px; color: #94a3b8;">No submitted leads found.</td></tr>`;
      } else {
        leads.forEach(lead => {
          const assignedName = lead.assigned_to ? lead.assigned_to.full_name : '(unassigned)';
          const statusClass = lead.status === 'closed_won' ? 'closed_won' : (lead.status === 'closed_lost' ? 'sla_breach' : 'assigned');

          const row = document.createElement('tr');
          row.style.borderBottom = '1px solid #f1f5f9';
          row.innerHTML = `
            <td style="padding: 10px;"><strong>${escapeHtml(lead.client_name)}</strong></td>
            <td style="padding: 10px; color: #475569;">${escapeHtml(assignedName)}</td>
            <td style="padding: 10px; text-align: center;"><span class="badge ${statusClass}">${lead.status.replace('_', ' ').toUpperCase()}</span></td>
          `;
          tbody.appendChild(row);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Load attendance status
  // ---------------------------------------------------------------------------
  if (typeof loadEmployeeApplicationsStatus === 'function') {
    await loadEmployeeApplicationsStatus();
  }
}

// ---------------------------------------------------------------------------
// Modal Controllers
// ---------------------------------------------------------------------------
let profileModalTargetId = null;

async function openPersonalInfoModal(targetId) {
  profileModalTargetId = targetId || currentUser.id;
  const isViewingOther = profileModalTargetId !== currentUser.id;

  document.getElementById('personal-info-modal').style.display = 'flex';

  // 1. Fetch fresh profile details from Supabase for whichever employee we're viewing
  let profile = isViewingOther ? {} : currentUser;
  try {
    const { data: freshProfile, error } = await supabaseClient
      .from('profiles')
      .select('full_name, email, phone, mobile_number, date_of_birth, address, avatar_url, is_locked')
      .eq('id', profileModalTargetId)
      .single();

    if (!error && freshProfile) {
      profile = freshProfile;
      if (!isViewingOther) {
        // Update global currentUser memory only when viewing our own profile
        Object.assign(currentUser, freshProfile);
      }
    }
  } catch (err) {
    console.warn("Could not load fresh profile, falling back to local user memory:", err);
  }

  // 2. Modal title reflects whose profile this is
  const titleEl = document.getElementById('personal-info-modal-title');
  if (titleEl) {
    titleEl.textContent = isViewingOther
      ? `Personal Profile Details — ${profile.full_name || 'Employee'}`
      : 'Personal Profile Details';
  }

  // 3. Populate Fields with Fresh Data
  document.getElementById('prof-name').value = profile.full_name || (isViewingOther ? '' : currentUser.full_name) || '';
  document.getElementById('prof-email').value = profile.email || (isViewingOther ? '' : currentUser.email) || '';
  document.getElementById('prof-phone').value = profile.phone || '';
  document.getElementById('prof-mobile').value = profile.mobile_number || '';
  document.getElementById('prof-address').value = profile.address || '';
  document.getElementById('prof-dob').value = profile.date_of_birth || '';

  // 4. Avatar Preview Handler (with Cache Buster)
  const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='%23cbd5e1'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

  const avatarUrl = profile.avatar_url || (isViewingOther ? null : currentUser.avatar_url);
  const avatarWithCache = avatarUrl ? `${avatarUrl}?t=${Date.now()}` : defaultAvatar;

  const formAvatar = document.getElementById('form-avatar-preview');
  if (formAvatar) {
    formAvatar.src = avatarWithCache;
  }

  const cardAvatar = document.getElementById('card-user-avatar');
  if (cardAvatar && !isViewingOther) {
    cardAvatar.src = avatarWithCache;
  }

  // 5. Lock State — HR/Admin editing someone else's profile can always edit,
  //    regardless of that employee's self-service lock. The lock only
  //    restricts the employee editing their own profile.
  const isLocked = isViewingOther ? false : (profile.is_locked || false);

  const warningElem = document.getElementById('profile-lock-warning');
  if (warningElem) warningElem.style.display = isLocked ? 'block' : 'none';

  const saveBtn = document.getElementById('save-profile-btn');
  if (saveBtn) saveBtn.style.display = isLocked ? 'none' : 'block';

  const avatarContainer = document.getElementById('avatar-input-container');
  if (avatarContainer) avatarContainer.style.display = isLocked ? 'none' : 'block';

  const docUploadSection = document.getElementById('document-upload-section');
  if (docUploadSection) docUploadSection.style.display = isLocked ? 'none' : 'block';

  // Disable input fields if profile is locked
  document.querySelectorAll('#personal-info-form input:not([type="hidden"])').forEach(input => {
    if (input.id !== 'prof-email') input.disabled = isLocked;
  });

  // 6. Load Document Attachments List for the correct employee
  if (typeof loadUserDocuments === 'function') {
    await loadUserDocuments(profileModalTargetId);
  }
}


function closePersonalInfoModal() {
  document.getElementById('personal-info-modal').style.display = 'none';
  profileModalTargetId = null;
}


// ---------------------------------------------------------------------------
// Profile Save & File Upload Handler
// ---------------------------------------------------------------------------
async function savePersonalProfile(e) {
  e.preventDefault();

  const targetId = profileModalTargetId || currentUser.id;
  const isViewingOther = targetId !== currentUser.id;

  // Self-service lock only applies when editing your own profile.
  // HR/Admin editing someone else's profile can always save.
  if (!isViewingOther && currentUser.is_locked) return;

  const btn = document.getElementById('save-profile-btn');
  btn.disabled = true;
  btn.textContent = 'Saving Profile...';

  try {
    let avatarUrl = isViewingOther ? null : currentUser.avatar_url;

    // Handle Avatar Upload
    const avatarFileInput = document.getElementById('profile-avatar-input') || document.getElementById('prof-avatar-input');
    const avatarFile = avatarFileInput ? avatarFileInput.files[0] : null;

    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop();
      // Use simple clean path without special characters or UUID mismatches
      const filePath = `avatars/${targetId}_${Date.now()}.${ext}`;

      const { error: upErr } = await supabaseClient.storage
        .from('employee-avatars')
        .upload(filePath, avatarFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: avatarFile.type || 'image/jpeg'
        });

      if (upErr) {
        console.error("Avatar Upload Error Details:", upErr);
        throw upErr;
      }

      const { data: pubUrl } = supabaseClient.storage
        .from('employee-avatars')
        .getPublicUrl(filePath);

      avatarUrl = pubUrl.publicUrl;
    }
    // Save Documents
    if (typeof uploadDocIfPresent === 'function') {
      const documentInputs = [
        ['doc-education', 'education'],
        ['doc-course', 'course'],
        ['doc-salary-slip', 'last_salary_slip'],
        ['doc-probation-letter', 'probation_letter'],
        ['doc-utility-bill', 'utility_bill'],
        ['doc-confirmation-letter', 'confirmation_letter'],
        ['doc-warning-letter', 'warning_letter']
      ];
      for (const [inputId, documentType] of documentInputs) {
        await uploadDocIfPresent(inputId, documentType, targetId);
      }
    }

    // Build the update payload. Only self-edits lock the profile after
    // saving — HR editing someone else's profile never touches is_locked,
    // so it doesn't accidentally lock or unlock that employee.
    const updatePayload = {
      full_name: document.getElementById('prof-name').value,
      phone: document.getElementById('prof-phone').value,
      mobile_number: document.getElementById('prof-mobile').value,
      address: document.getElementById('prof-address').value,
      date_of_birth: document.getElementById('prof-dob').value
    };
    if (avatarUrl) {
      updatePayload.avatar_url = avatarUrl;
    }
    if (!isViewingOther) {
      updatePayload.is_locked = true; // Lock profile after self-save
    }

    const { error: profErr } = await supabaseClient
      .from('profiles')
      .update(updatePayload)
      .eq('id', targetId);

    if (profErr) throw profErr;

    if (!isViewingOther) {
      // Update local currentUser object
      if (avatarUrl) currentUser.avatar_url = avatarUrl;
      currentUser.is_locked = true;

      // Instantly reflect updated image on card before page reload
      const cardAvatar = document.getElementById('card-user-avatar');
      if (cardAvatar && avatarUrl) {
        cardAvatar.src = avatarUrl;
      }

      alert('Profile information saved and locked successfully.');
      location.reload();
    } else {
      alert('Employee profile updated successfully.');
      closePersonalInfoModal();
      // Refresh the directory list to reflect the updated name/details
      if (typeof loadEmployeeDirectoryData === 'function') {
        await loadEmployeeDirectoryData();
      }
    }

  } catch (err) {
    alert('Failed to save profile: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Profile & Lock Changes';
  }
}
function openMeetingsCalendarModal() {
  const modal = document.getElementById('meetings-calendar-modal');
  if (modal) {
    modal.style.display = 'flex';
    renderMeetingsCalendar(); // Now populates #meetings-calendar-grid inside the visible modal!
  }
}

function closeMeetingsCalendarModal() {
  const modal = document.getElementById('meetings-calendar-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}
async function uploadDocIfPresent(inputId, docType, targetId) {
  const employeeId = targetId || currentUser.id;
  const fileInput = document.getElementById(inputId);
  const file = fileInput?.files[0];
  if (!file) return;

  const allowedExtension = /\.(pdf|png|jpe?g|gif|webp)$/i.test(file.name);
  const allowedMimeType = file.type === 'application/pdf' || file.type.startsWith('image/');
  if (!allowedExtension && !allowedMimeType) {
    throw new Error('Please upload an image or PDF for each document.');
  }

  const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${employeeId}/${docType}_${Date.now()}.${ext}`;

  const { error: upErr } = await supabaseClient.storage
    .from('employee-certificates')
    .upload(path, file, {
      contentType: file.type || undefined,
      upsert: false
    });
  if (upErr) throw upErr;

  const { data: pubUrl } = supabaseClient.storage.from('employee-certificates').getPublicUrl(path);

  const { error: documentError } = await supabaseClient.from('employee_documents').insert({
    user_id: employeeId,
    document_type: docType,
    document_name: file.name,
    file_url: pubUrl.publicUrl
  });
  if (documentError) {
    await supabaseClient.storage.from('employee-certificates').remove([path]);
    throw documentError;
  }
}

async function loadUserDocuments(targetId) {
  const employeeId = targetId || currentUser.id;
  const container = document.getElementById('uploaded-docs-list');
  const { data: docs } = await supabaseClient
    .from('employee_documents')
    .select('document_name, document_type, file_url')
    .eq('user_id', employeeId);

  if (!docs || docs.length === 0) {
    container.innerHTML = '<p style="font-size:0.8rem; color:#94a3b8;">No documents uploaded yet.</p>';
    return;
  }

  container.innerHTML = '<strong>Uploaded Assets:</strong><ul style="font-size: 0.85rem; padding-left: 1.2rem;">' +
    docs.map(d => `<li><a href="${d.file_url}" target="_blank">${escapeHtml(d.document_name)}</a> (${d.document_type.toUpperCase()})</li>`).join('') +
    '</ul>';
}

// ---------------------------------------------------------------------------
// Time formatting helper (no await inside, standard function is fine)
// FIXED: removed the orphaned/duplicate "Case 2" ISO-parsing block that was
// sitting outside this function (using undefined variables + an illegal
// top-level `return`). This is now the single, complete version.
// ---------------------------------------------------------------------------
function formatPktTime(rawTimeStr) {
  if (!rawTimeStr) return '-- : --';
  let timeStr = String(rawTimeStr).trim();

  // Case 1: Simple HH:MM or HH:MM:SS string (e.g., "08:21:00" or "08:21 AM")
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i.test(timeStr)) {
    const parts = timeStr.split(':');
    let hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);

    if (timeStr.toLowerCase().includes('pm') && hours < 12) hours += 12;
    if (timeStr.toLowerCase().includes('am') && hours === 12) hours = 0;

    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes < 10 ? '0' + minutes : minutes;

    return `${displayHours < 10 ? '0' + displayHours : displayHours}:${displayMinutes} ${ampm}`;
  }

  // Case 2: ISO Timestamps / Timestamptz from Supabase (+00 / Z)
  const parsedDate = new Date(timeStr);
  if (isNaN(parsedDate.getTime())) return rawTimeStr;

  // Convert and render accurately in PKT (Asia/Karachi / UTC+5)
  return parsedDate.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function formatPktClockTime(rawTime) {
  if (!rawTime) return 'N/A';
  const parsedDate = new Date(rawTime);
  if (isNaN(parsedDate.getTime())) return 'N/A';

  return parsedDate.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
}

// ---------------------------------------------------------------------------
// Employee Applications Status (attendance card + HR applications table)
// FIXED: this entire block used to be floating outside any function
// (using `await` at the top level, which is illegal). It's now properly
// wrapped as its own async function, matching your 700-800.txt file.
// ---------------------------------------------------------------------------
async function loadEmployeeApplicationsStatus() {
  const statusBody = document.getElementById('employee-applications-status-body');

  // ==========================================
  // A. FETCH ATTENDANCE / PUNCH DATA (TOP CARD 1)
  // ==========================================
  const badgeEl = document.getElementById('sales-attendance-badge');
  const timeInEl = document.getElementById('sales-attendance-time-in');
  const timeOutEl = document.getElementById('sales-attendance-time-out');
  const labelEl = document.getElementById('sales-attendance-label');

  if (timeInEl && timeOutEl) {
    try {
      // 1. Prepare badge for click interaction & tooltip
      if (badgeEl && currentUser) {
        badgeEl.style.cursor = 'pointer';
        badgeEl.title = 'Click to inspect complete monthly calendar log';

        // Calculate target month (YYYY-MM)
        const targetMonth = document.getElementById('hr-month-select')?.value || new Date().toISOString().slice(0, 7);

        // Bind existing calendar modal function
        badgeEl.onclick = () => {
          if (typeof openEmployeeCalendar === 'function') {
            openEmployeeCalendar(currentUser.id, currentUser.name || 'My Attendance', targetMonth);
          }
        };
      }

      const zkId = currentUser.zk_user_id ? String(currentUser.zk_user_id) : null;

      let latestIn = null;
      let latestOut = null;
      let zkQueryFailed = false;

      if (zkId) {
        // Fetch the latest IN punch and the latest OUT punch separately,
        // since punch_type ('IN'/'OUT') lives on its own row each time.
        const [inResponse, outResponse] = await Promise.all([
          supabaseClient
            .from('raw_attendance_logs')
            .select('*')
            .eq('zk_user_id', zkId)
            .eq('punch_type', 'IN')
            .order('punch_time', { ascending: false })
            .limit(1),
          supabaseClient
            .from('raw_attendance_logs')
            .select('*')
            .eq('zk_user_id', zkId)
            .eq('punch_type', 'OUT')
            .order('punch_time', { ascending: false })
            .limit(1)
        ]);

        if (inResponse.error || outResponse.error) {
          zkQueryFailed = true;
        } else {
          latestIn = (inResponse.data && inResponse.data[0]) || null;
          latestOut = (outResponse.data && outResponse.data[0]) || null;
        }
      }

      if (!zkId || zkQueryFailed || (!latestIn && !latestOut)) {
        // Fallback: shift_records table, which stores in_time/out_time
        // together on a single row per shift.
        const { data: shifts, error: shiftErr } = await supabaseClient
          .from('shift_records')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (shiftErr || !shifts || shifts.length === 0) {
          timeInEl.textContent = 'No Record';
          timeOutEl.textContent = 'No Record';
          if (badgeEl) {
            badgeEl.textContent = 'ABSENT';
            badgeEl.style.background = '#fee2e2';
            badgeEl.style.color = '#b91c1c';
          }
          if (labelEl) labelEl.textContent = 'No attendance logs found';
        } else {
          const lastShift = shifts[0];
          const rawIn = lastShift.in_time || lastShift.check_in || lastShift.punch_time || lastShift.created_at;
          const rawOut = lastShift.out_time || lastShift.check_out;

          timeInEl.textContent = formatPktTime(rawIn);
          timeOutEl.textContent = rawOut ? formatPktTime(rawOut) : 'Still on shift';

          if (badgeEl) {
            const statusText = (lastShift.status || 'PRESENT').toUpperCase();
            badgeEl.textContent = statusText;

            if (statusText === 'LATE') {
              badgeEl.style.background = '#fef3c7';
              badgeEl.style.color = '#d97706';
            } else if (statusText === 'ABSENT') {
              badgeEl.style.background = '#fee2e2';
              badgeEl.style.color = '#b91c1c';
            } else {
              badgeEl.style.background = '#dcfce7';
              badgeEl.style.color = '#15803d';
            }
          }
          if (labelEl) labelEl.textContent = `Shift: ${lastShift.shift_date || new Date().toLocaleDateString()}`;
        }
      } else {
        // We have punch rows from raw_attendance_logs.
        timeInEl.textContent = latestIn ? formatPktTime(latestIn.punch_time) : '-- : --';

        const inTime = latestIn ? new Date(latestIn.punch_time) : null;
        const outTime = latestOut ? new Date(latestOut.punch_time) : null;

        // Only treat OUT as "belonging" to this IN if it happened after it.
        const hasClosedOut = outTime && (!inTime || outTime > inTime);

        timeOutEl.textContent = hasClosedOut ? formatPktTime(latestOut.punch_time) : 'Still on shift';

        if (badgeEl) {
          if (hasClosedOut) {
            badgeEl.textContent = 'CLOCKED OUT';
            badgeEl.style.background = '#e2e8f0';
            badgeEl.style.color = '#475569';
          } else if (inTime) {
            badgeEl.textContent = 'PRESENT';
            badgeEl.style.background = '#dcfce7';
            badgeEl.style.color = '#15803d';
          } else {
            badgeEl.textContent = 'ABSENT';
            badgeEl.style.background = '#fee2e2';
            badgeEl.style.color = '#b91c1c';
          }
        }

        const deviceRef = (hasClosedOut ? latestOut : latestIn)?.device_id || 'TERMINAL';
        if (labelEl) labelEl.textContent = `Device: ${deviceRef}`;
      }
    } catch (e) {
      console.error("Runtime exception loading attendance:", e);
      timeInEl.textContent = '-- : --';
      timeOutEl.textContent = '-- : --';
    }
  }
  // ==========================================
  // B. FETCH HR APPLICATIONS (BOTTOM TABLE)
  // ==========================================
  if (!statusBody) return;

  try {
    const { data: apps, error } = await supabaseClient
      .from('attendance_applications')
      .select('type, target_date, reason, status, hr_comments')
      .eq('user_id', currentUser.id)
      .order('target_date', { ascending: false });

    if (error) {
      statusBody.innerHTML = `<tr><td colspan="5" style="color: #dc2626; text-align: center; padding: 15px;">Database Error: ${error.message}</td></tr>`;
      return;
    }

    statusBody.innerHTML = '';

    if (!apps || apps.length === 0) {
      statusBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 15px; color: #94a3b8;">You haven't submitted any applications yet.</td></tr>`;
      return;
    }

    apps.forEach(app => {
      const cleanType = app.type ? app.type.replace('_', ' ').toUpperCase() : 'APPLICATION';
      const cleanReason = app.reason || '';
      const hrNotes = app.hr_comments ? app.hr_comments : '--';
      const currentStatus = app.status || 'pending';

      let statusBadgeStyle = '';
      if (currentStatus === 'approved') {
        statusBadgeStyle = 'background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 4px; font-weight: bold;';
      } else if (currentStatus === 'rejected') {
        statusBadgeStyle = 'background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-weight: bold;';
      } else {
        statusBadgeStyle = 'background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 4px; font-weight: bold;';
      }

      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid #e2e8f0';
      row.innerHTML = `
        <td style="padding: 10px; font-weight: 500;">${cleanType}</td>
        <td style="padding: 10px; color: #475569;">${app.target_date || '--'}</td>
        <td style="padding: 10px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cleanReason}</td>
        <td style="padding: 10px;"><span style="${statusBadgeStyle}">${currentStatus.toUpperCase()}</span></td>
        <td style="padding: 10px; color: #64748b; font-style: italic;">${hrNotes}</td>
      `;
      statusBody.appendChild(row);
    });

  } catch (err) {
    console.error("Employee applications status queue load failure:", err);
    statusBody.innerHTML = `<tr><td colspan="5" style="color: #dc2626; text-align: center; padding: 15px;">Runtime Error: ${err.message}</td></tr>`;
  }
}
// ---------------------------------------------------------------------------
// Employee Dispute Submission Logic
// ---------------------------------------------------------------------------
async function submitPayrollDispute(e) {
  e.preventDefault();

  const monthYear = document.getElementById('dispute-month').value;
  const disputeType = document.getElementById('dispute-type').value;
  const reason = document.getElementById('dispute-reason').value.trim();

  const { data: lockCheck } = await supabaseClient
    .from('payroll_records')
    .select('is_locked')
    .eq('month_year', monthYear)
    .limit(1);

  if (lockCheck && lockCheck.length > 0 && lockCheck[0].is_locked) {
    alert(`Cannot file dispute: Payroll for ${monthYear} is locked.`);
    return;
  }

  const { error } = await supabaseClient
    .from('payroll_disputes')
    .insert({
      user_id: currentUser.id,
      month_year: monthYear,
      dispute_type: disputeType,
      reason: reason
    });

  if (error) {
    alert('Dispute filing failed: ' + error.message);
    return;
  }

  alert('Dispute submitted successfully to HR.');
  const form = document.getElementById('dispute-form');
  if (form) {
    form.reset();
  }
}

// ---------------------------------------------------------------------------
// HR/Admin Portal - Data Load, Lock Safeguards & Dispute Queue
// ---------------------------------------------------------------------------
function getSelectedMonth() {
  const picker = document.getElementById('hr-month-picker');
  return (picker && picker.value) ? picker.value : new Date().toISOString().slice(0, 7);
}

async function loadHrPortalData() {
  const monthYear = getSelectedMonth();
  const tbody = document.getElementById('hr-payroll-body');

  try {
    // 1. Fetch ALL active profiles without requesting base_salary column
    const { data: profiles, error: profileErr } = await supabaseClient
      .from('profiles')
      .select('id, full_name, role');

    if (profileErr) {
      tbody.innerHTML = `<tr><td colspan="7" style="color: var(--accent-red);">Error loading profiles: ${profileErr.message}</td></tr>`;
      return;
    }

    // 2. Fetch existing payroll records for the selected month
    const { data: records, error: payrollErr } = await supabaseClient
      .from('payroll_records')
      .select(`
        user_id, base_salary_pkr, lop_days, lop_deduction_pkr,
        net_payable_pkr, status, is_locked, locked_at,
        profile:profiles!payroll_records_user_id_fkey(full_name, role),
        locked_by_profile:profiles!payroll_records_locked_by_fkey(full_name)
      `)
      .eq('month_year', monthYear);

    if (payrollErr) {
      tbody.innerHTML = `<tr><td colspan="7" style="color: var(--accent-red);">Error loading payroll: ${payrollErr.message}</td></tr>`;
      return;
    }

    // Map payroll records by user_id for quick lookup
    const recordMap = new Map((records || []).map(r => [r.user_id, r]));

    // Update lock status UI based on existing records
    const sampleRecord = records && records.length > 0 ? records[0] : null;
    const isLocked = sampleRecord ? sampleRecord.is_locked || false : false;
    const lockedByName = sampleRecord?.locked_by_profile?.full_name || '';
    const lockedAt = sampleRecord?.locked_at || null;
    updatePayrollLockUI(isLocked, lockedByName, lockedAt);

    tbody.innerHTML = '';
    let totalPayroll = 0;

    // 3. Iterate through ALL profiles so everyone is visible
    profiles.forEach(p => {
      const r = recordMap.get(p.id);

      const baseSalary = r ? parseFloat(r.base_salary_pkr || 0) : 0;
      const lopDays = r ? r.lop_days : 0;
      const lopDeduction = r ? parseFloat(r.lop_deduction_pkr || 0) : 0;
      const netPayable = r ? parseFloat(r.net_payable_pkr || 0) : 0;

      totalPayroll += netPayable;

      const name = p.full_name || '(unknown)';
      const role = p.role || '';

      const statusText = r ? (r.is_locked ? 'LOCKED' : (r.status ? r.status.toUpperCase() : 'DRAFT')) : 'DRAFT';
      const statusClass = r?.is_locked
        ? 'closed_won'
        : (r?.status === 'disputed' ? 'sla_breach' : 'assigned');

      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${escapeHtml(name)}</strong></td>
        <td>${escapeHtml(role)}</td>
        <td>${baseSalary.toLocaleString('en-US')} PKR</td>
        <td>${lopDays}</td>
        <td>${lopDeduction > 0 ? '-' : ''}${lopDeduction.toLocaleString('en-US', { minimumFractionDigits: 2 })} PKR</td>
        <td><strong style="color: var(--accent-cyan); font-size: 1rem;">${netPayable.toLocaleString('en-US')} PKR</strong></td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
      `;

      const targetMonth = document.getElementById('hr-month-picker')?.value || '2026-08';
      row.style.cursor = 'pointer';
      row.title = 'Click to inspect complete monthly calendar log';
      row.onclick = () => openEmployeeCalendar(p.id, name, targetMonth);

      tbody.appendChild(row);
    });

    document.getElementById('hr-total-payroll').textContent = `${totalPayroll.toLocaleString('en-US')} PKR`;

  } catch (err) {
    console.error('Error rendering HR portal:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="color: var(--accent-red);">Unexpected error rendering portal data.</td></tr>`;
  }

  // Shift Attendance Calculation — same 16th-to-15th pay period as the payroll engine
  const { startDate: attStartDate, endDate: attEndDate } = getPayPeriodRange(monthYear);
  const { data: shiftStats } = await supabaseClient
    .from('shift_records')
    .select('status')
    .gte('shift_date', attStartDate)
    .lt('shift_date', attEndDate);

  if (shiftStats && shiftStats.length > 0) {
    const attended = shiftStats.filter(s => s.status === 'present' || s.status === 'late').length;
    const pct = ((attended / shiftStats.length) * 100).toFixed(1);
    document.getElementById('hr-attendance-pct').textContent = `${pct}%`;
  } else {
    document.getElementById('hr-attendance-pct').textContent = 'No data';
  }

  await loadHrDisputesQueue(monthYear);
  await loadHrAttendanceApplicationsQueue();
}
async function loadHrDisputesQueue(monthYear) {
  const disputesTbody = document.getElementById('hr-disputes-body');
  if (!disputesTbody) return;

  const { data: disputes, error } = await supabaseClient
    .from('payroll_disputes')
    .select(`
      id, dispute_type, reason, status,
      user:profiles!payroll_disputes_user_id_fkey(full_name)
    `)
    .eq('month_year', monthYear)
    .eq('status', 'pending');

  if (error) {
    disputesTbody.innerHTML = `<tr><td colspan="4" style="color: var(--accent-red);">Disputes Load Error: ${error.message}</td></tr>`;
    return;
  }

  disputesTbody.innerHTML = '';

  if (!disputes || disputes.length === 0) {
    disputesTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No pending disputes for ${monthYear}.</td></tr>`;
    return;
  }

  disputes.forEach(d => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${escapeHtml(d.user?.full_name || 'Unknown')}</strong></td>
      <td>${escapeHtml(d.dispute_type.replace('_', ' ').toUpperCase())}</td>
      <td>${escapeHtml(d.reason)}</td>
      <td>
        <button class="btn-primary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="handleResolveDispute('${d.id}', 'approved')">Approve</button>
        <button class="btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="handleResolveDispute('${d.id}', 'rejected')">Reject</button>
      </td>
    `;
    disputesTbody.appendChild(row);
  });
}

async function handleResolveDispute(disputeId, action) {
  const adminNotes = prompt(`Enter resolution notes for marking as ${action}:`) || 'Resolved by HR';

  const { data, error } = await supabaseClient.rpc('resolve_payroll_dispute', {
    p_dispute_id: disputeId,
    p_action: action,
    p_admin_notes: adminNotes,
    p_resolver_id: currentUser.id
  });

  if (error) {
    alert(`Resolution failed: ${error.message}`);
    return;
  }

  alert(data);
  await loadHrPortalData();
}

function nextMonthStr(monthYear) {
  const [y, m] = monthYear.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-01`;
}

function prevMonthStr(monthYear) {
  const [y, m] = monthYear.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Nazgrow pays on the 15th, covering the period from the 16th of the
// previous month through the 15th of the selected month (inclusive).
// e.g. selecting "2026-08" covers 2026-07-16 through 2026-08-15.
function getPayPeriodRange(monthYear) {
  const startDate = `${prevMonthStr(monthYear)}-16`;
  const endDate = `${monthYear}-16`; // exclusive upper bound, so the 15th is the last day included
  return { startDate, endDate };
}

async function runPayrollEngine() {
  const monthYear = getSelectedMonth();
  const { startDate, endDate } = getPayPeriodRange(monthYear);

  // 0. Guard: don't let a re-run silently unlock an already-locked month
  const { data: lockCheck, error: lockCheckErr } = await supabaseClient
    .from('payroll_records')
    .select('is_locked')
    .eq('month_year', monthYear)
    .eq('is_locked', true)
    .limit(1);

  if (lockCheckErr) {
    alert(`Error checking lock status: ${lockCheckErr.message}`);
    return;
  }
  if (lockCheck && lockCheck.length > 0) {
    alert(`Payroll for ${monthYear} is locked. Unlock it first if you need to re-run the engine.`);
    return;
  }

  // 1. Fetch all profiles with their REAL base salary
  const { data: profiles, error: profileErr } = await supabaseClient
    .from('profiles')
    .select('id, full_name, role, base_salary_pkr');

  if (profileErr) {
    alert(`Error fetching profiles: ${profileErr.message}`);
    return;
  }

  // 2. Fetch this month's attendance for ALL employees in one query
  const { data: shifts, error: shiftErr } = await supabaseClient
    .from('shift_records')
    .select('user_id, status, is_lop, shift_date')
    .gte('shift_date', startDate)
    .lt('shift_date', endDate);

  if (shiftErr) {
    alert(`Error fetching attendance: ${shiftErr.message}`);
    return;
  }

  // 3. Tally per-employee: full LOP days (is_lop = true) + late days
  //    Business rule: every 3 late days = 1 additional LOP day
  //    Sundays are a company-wide off day and are never counted as
  //    LOP or late, even if a bad row exists in shift_records for one.
  const attendanceByUser = {};
  for (const s of shifts) {
    const isSundayRow = new Date(s.shift_date + 'T00:00:00').getDay() === 0;
    if (isSundayRow) continue;

    if (!attendanceByUser[s.user_id]) {
      attendanceByUser[s.user_id] = { fullLopDays: 0, lateDays: 0 };
    }
    if (s.is_lop) {
      attendanceByUser[s.user_id].fullLopDays += 1;
    } else if (s.status === 'late') {
      attendanceByUser[s.user_id].lateDays += 1;
    }
  }

  // 4. Build payroll rows using real salary + real attendance-based LOP
  const payrollRows = profiles.map(p => {
    const att = attendanceByUser[p.id] || { fullLopDays: 0, lateDays: 0 };
    const lateLopDays = Math.floor(att.lateDays / 3); // 3 lates = 1 LOP day
    const totalLopDays = att.fullLopDays + lateLopDays;
    const baseSalary = p.base_salary_pkr ?? 50000;
    const deduction = Math.round((baseSalary / 26) * totalLopDays * 100) / 100;
    const netPayable = Math.max(0, baseSalary - deduction);

    return {
      user_id: p.id,
      month_year: monthYear,
      base_salary_pkr: baseSalary,
      lop_days: totalLopDays,
      lop_deduction_pkr: deduction,
      net_payable_pkr: netPayable,
      status: 'draft',
      is_locked: false
    };
  });

  // 5. Upsert into payroll_records
  const { error: upsertErr } = await supabaseClient
    .from('payroll_records')
    .upsert(payrollRows, { onConflict: 'user_id,month_year' });

  if (upsertErr) {
    alert(`Error running payroll engine: ${upsertErr.message}`);
    return;
  }

  // Refresh table UI
  await loadHrPortalData();
}
function updatePayrollLockUI(isLocked, lockedByUserName, lockedAtTimestamp) {
  const badge = document.getElementById('payroll-status-badge');
  const badgeText = document.getElementById('payroll-status-text');
  const badgeIcon = badge?.querySelector('.badge-icon');
  const lockBtn = document.getElementById('lock-payroll-btn');
  const metaText = document.getElementById('payroll-lock-meta');

  if (isLocked) {
    if (badge) badge.className = 'status-badge locked';
    if (badgeIcon) badgeIcon.textContent = '🔒';
    if (badgeText) badgeText.textContent = 'Payroll Locked';

    if (lockBtn) {
      lockBtn.textContent = 'Unlock Payroll';
      lockBtn.className = 'btn btn-unlock';
    }

    if (metaText && lockedByUserName) {
      metaText.style.display = 'inline';
      metaText.textContent = `Locked by ${lockedByUserName} on ${new Date(lockedAtTimestamp).toLocaleDateString()}`;
    }
  } else {
    if (badge) badge.className = 'status-badge unlocked';
    if (badgeIcon) badgeIcon.textContent = '🔓';
    if (badgeText) badgeText.textContent = 'Payroll Unlocked';

    if (lockBtn) {
      lockBtn.textContent = 'Lock Payroll';
      lockBtn.className = 'btn btn-lock';
    }

    if (metaText) {
      metaText.style.display = 'none';
    }
  }
}

async function lockPayroll() {
  const selectedMonthYear = getSelectedMonth();
  const currentUserId = currentUser.id;

  const { error } = await supabaseClient.rpc('lock_monthly_payroll', {
    p_month_year: selectedMonthYear,
    p_user_id: currentUserId
  });

  if (error) {
    alert(`Error locking payroll: ${error.message}`);
    return;
  }

  await loadHrPortalData();
}

// ---------------------------------------------------------------------------
// Calendar UI Control Logic Functions
// ---------------------------------------------------------------------------
async function openEmployeeCalendar(userId, employeeName, targetMonth = '2026-08') {
  const container = document.getElementById('calendar-days-container');
  document.getElementById('calendar-modal-title').innerText = `${employeeName}'s Attendance History`;
  document.getElementById('calendar-modal-subtitle').innerText = `Month Summary Profile: ${targetMonth}`;
  container.innerHTML = '<p style="grid-column: span 7; color:#94a3b8;">Loading attendance data matrix...</p>';

  document.getElementById('calendar-modal').style.display = 'flex';

  const { data, error } = await supabaseClient.rpc('get_monthly_attendance_report', {
    target_user_id: userId,
    target_month: targetMonth
  });

  if (error) {
    container.innerHTML = `<p style="grid-column: span 7; color:#ef4444;">Error: ${error.message}</p>`;
    return;
  }

  container.innerHTML = '';

  const recordsMap = {};
  if (data) {
    data.forEach(rec => { recordsMap[rec.shift_date] = rec; });
  }

  const [year, month] = targetMonth.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();

  // Leading blank cells so day 1 lands under its real weekday.
  // Grid header is Mon-Sun, but JS getDay() is Sun(0)-Sat(6), so convert.
  const firstDayJsIndex = new Date(year, month - 1, 1).getDay(); // 0=Sun...6=Sat
  const leadingBlanks = (firstDayJsIndex + 6) % 7; // 0=Mon...6=Sun

  for (let i = 0; i < leadingBlanks; i++) {
    container.innerHTML += `<div class="calendar-day-box" style="background: transparent; box-shadow: none;"></div>`;
  }

  for (let day = 1; day <= totalDays; day++) {
    const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const record = recordsMap[dayStr];
    const isSunday = new Date(year, month - 1, day).getDay() === 0;

    let bgColor = 'rgba(255, 255, 255, 0.02)';
    let dotColor = 'transparent';
    let label = 'No Entry / Off';
    let titleHover = `Date: ${dayStr} - No Log Tracked`;

    if (isSunday) {
      // Sunday is always a company off day — ignore whatever the database
      // says for this date, since bad Sunday rows shouldn't be shown as
      // attendance at all.
      bgColor = 'rgba(148, 163, 184, 0.08)';
      label = 'Off (Sunday)';
      titleHover = `Date: ${dayStr}\nWeekly Off (Sunday)`;
    } else if (record) {
      titleHover = `Date: ${dayStr}\nIn: ${formatPktClockTime(record.in_time)}\nOut: ${formatPktClockTime(record.out_time)}\nStatus: ${record.status.toUpperCase()}`;
      if (record.status === 'present') {
        dotColor = '#34d399'; bgColor = 'rgba(52, 211, 153, 0.1)'; label = 'Present';
      } else if (record.status === 'late') {
        dotColor = '#fbbf24'; bgColor = 'rgba(251, 191, 36, 0.1)'; label = `Late (${record.late_minutes}m)`;
      } else if (record.status.includes('lop')) {
        dotColor = '#f87171'; bgColor = 'rgba(248, 113, 113, 0.1)'; label = 'LOP Deducted';
      } else if (record.status === 'regularized') {
        dotColor = '#c084fc'; bgColor = 'rgba(192, 132, 252, 0.1)'; label = 'Regularized';
      }
    }

    container.innerHTML += `
      <div class="calendar-day-box" style="background: ${bgColor};" title="${titleHover}">
        <span style="font-weight: 600; color: #f1f5f9;">${day}</span>
        <span style="font-size: 0.65rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${isSunday ? label : (record ? label : 'Off')}</span>
        <div class="day-status-dot" style="background: ${dotColor};"></div>
      </div>
    `;
  }
}

function closeCalendarModal() {
  document.getElementById('calendar-modal').style.display = 'none';
}

// ---------------------------------------------------------------------------
// Unified Helper Cleanups (Preventing Duplicate Reference Errors)
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function roleLabel(role) {
  const roles = {
    'sales': 'Sales Rep',
    'operations': 'Ops Manager',
    'hr': 'HR Manager',
    'admin': 'Administrator'
  };
  return roles[role] || role || 'Employee';
}

// ---------------------------------------------------------------------------
// Attendance/Regularization Application Submission (Employee side)
// ---------------------------------------------------------------------------
async function handleApplicationSubmission(e) {
  e.preventDefault();

  const fileInput = document.getElementById('proof-file');
  const type = document.getElementById('app-type').value;
  const targetDate = document.getElementById('app-date').value;
  const reason = document.getElementById('app-reason').value;

  let uploadedUrl = null;

  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

    if (sessionError || !session) {
      alert("Authentication session error: Please sign in again.");
      return;
    }

    const user = session.user;

    // Process file upload into the 'regularization-proofs' storage bucket
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const fileExtension = file.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExtension}`;

      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('regularization-proofs')
        .upload(filePath, file);

      if (uploadError) {
        alert('Proof asset upload failed: ' + uploadError.message);
        return;
      }

      uploadedUrl = uploadData.path;
    }

    // Insert structured entry into database table
    const { data, error } = await supabaseClient
      .from('attendance_applications')
      .insert([
        {
          user_id: user.id,
          type: type,
          target_date: targetDate,
          reason: reason,
          proof_attachment_url: uploadedUrl,
          status: 'pending'
        }
      ]);

    if (error) {
      alert('Database Insert failed: ' + error.message);
    } else {
      alert('Application successfully delivered to HR Review dashboard queue!');
      location.reload();
    }
  } catch (err) {
    console.error("Runtime submission crash:", err);
    alert("An unexpected error occurred. Check the DevTools console details.");
  }
}

// ---------------------------------------------------------------------------
// Attendance/Regularization Application Review (HR side)
// ---------------------------------------------------------------------------
async function updateApplicationStatus(applicationId, targetDate, newStatus, hrComments = '') {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    alert("Session expired.");
    return;
  }
  const user = session.user;

  // 1. Update the application status rule
  const { data, error } = await supabaseClient
    .from('attendance_applications')
    .update({
      status: newStatus,
      hr_comments: hrComments,
      reviewed_by: user.id,
      updated_at: new Date().toISOString()
    })
    .eq('id', applicationId);

  if (error) {
    console.error('Update failed:', error.message);
    alert('Failed to update status: ' + error.message);
  } else {
    console.log(`Application marked as ${newStatus}`);

    // 2. Force payroll engine to refresh and apply changes immediately
    const { error: rpcError } = await supabaseClient.rpc('process_night_shift_attendance', {
      target_date: targetDate
    });

    if (rpcError) console.error('Payroll rerun error:', rpcError);

    alert(`Application successfully ${newStatus}!`);
    location.reload();
  }
}

// ---------------------------------------------------------------------------
// HR Attendance Applications Queue (full history, with approve/reject actions
// only shown while an application is still pending)
// FIXED: this function used to be defined twice — an earlier "pending only"
// version and this fuller "all history" version. Since JS keeps the last
// definition, the first copy was silently dead code. It's now the single
// definition, so nothing changes at runtime, but the file no longer has
// duplicate declarations.
// ---------------------------------------------------------------------------
async function loadHrAttendanceApplicationsQueue() {
  const queueBody = document.getElementById('hr-apps-queue-body');
  if (!queueBody) return;

  try {
    const { data: apps, error } = await supabaseClient
      .from('attendance_applications')
      .select(`
        id, type, target_date, reason, proof_attachment_url, status, hr_comments,
        profile:profiles!attendance_applications_user_id_fkey(full_name)
      `)
      .order('created_at', { ascending: false }); // Newest submissions first

    if (error) throw error;

    queueBody.innerHTML = '';

    if (!apps || apps.length === 0) {
      queueBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: #94a3b8;">No attendance applications found in system history.</td></tr>`;
      return;
    }

    apps.forEach(app => {
      const empName = app.profile ? escapeHtml(app.profile.full_name) : 'Unknown Employee';
      const cleanType = app.type.replace('_', ' ').toUpperCase();
      const cleanReason = escapeHtml(app.reason);
      const currentStatus = app.status || 'pending';
      const hrNotes = app.hr_comments ? escapeHtml(app.hr_comments) : '--';

      // Generate attachment link
      let proofLinkHtml = '<span style="color:#94a3b8;">No Proof Provided</span>';
      if (app.proof_attachment_url) {
        const { data: publicUrlData } = supabaseClient.storage
          .from('regularization-proofs')
          .getPublicUrl(app.proof_attachment_url);

        if (publicUrlData?.publicUrl) {
          proofLinkHtml = `<a href="${publicUrlData.publicUrl}" target="_blank" style="color: #2563eb; font-weight: 500; text-decoration: underline;">View Asset ↗</a>`;
        }
      }

      // Configure badge colors dynamically based on actual status
      let statusBadgeStyle = '';
      if (currentStatus === 'approved') {
        statusBadgeStyle = 'background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 4px; font-weight: bold;';
      } else if (currentStatus === 'rejected') {
        statusBadgeStyle = 'background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-weight: bold;';
      } else {
        statusBadgeStyle = 'background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 4px; font-weight: bold;';
      }

      // Render Action options ONLY if it's still pending
      let actionHtml = '';
      if (currentStatus === 'pending') {
        actionHtml = `
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn-primary" style="padding: 6px 12px; font-size: 12px; background: #16a34a; border-radius: 4px;"
              onclick="handleAppReview('${app.id}', '${app.target_date}', 'approved')">Approve</button>
            <button class="btn-secondary" style="padding: 6px 12px; font-size: 12px; background: #dc2626; color: white; border: none; border-radius: 4px;"
              onclick="handleAppReview('${app.id}', '${app.target_date}', 'rejected')">Reject</button>
          </div>`;
      } else {
        actionHtml = `<div style="color: #64748b; font-size: 0.85rem; font-style: italic;">Notes: ${hrNotes}</div>`;
      }

      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid #e2e8f0';
      row.innerHTML = `
        <td style="padding: 12px;"><strong>${empName}</strong></td>
        <td style="padding: 12px;"><span style="${statusBadgeStyle}">${cleanType}</span></td>
        <td style="padding: 12px; color: #475569;">${app.target_date}</td>
        <td style="padding: 12px; max-width: 250px; word-wrap: break-word;">${cleanReason}</td>
        <td style="padding: 12px;">${proofLinkHtml}</td>
        <td style="padding: 12px; text-align: center;"><span style="${statusBadgeStyle}">${currentStatus.toUpperCase()}</span></td>
        <td style="padding: 12px; text-align: center;">${actionHtml}</td>
      `;
      queueBody.appendChild(row);
    });

  } catch (err) {
    console.error("Applications UI Queue Failure:", err);
    queueBody.innerHTML = `<tr><td colspan="7" style="color: #dc2626; text-align: center; padding: 20px;">Error rendering queue: ${err.message}</td></tr>`;
  }
}

// Intermediary click function to call the update status pipeline
function handleAppReview(appId, targetDate, action) {
  const comment = prompt(`Enter optional HR notes for this ${action} decision:`) || 'Processed via HR Console';
  updateApplicationStatus(appId, targetDate, action, comment);
}

async function renderMeetingsCalendar() {
  const grid = document.getElementById('meetings-calendar-grid');
  const monthTitle = document.getElementById('meetings-calendar-month-title');
  if (!grid) return;

  grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: #64748b;">Loading calendar...</div>';

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (monthTitle) {
    const monthName = now.toLocaleString('default', { month: 'long' });
    monthTitle.textContent = `${monthName} ${year}`;
  }

  // Calculate ISO range for current month
  const startOfMonth = new Date(year, month, 1).toISOString();
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();

  let monthLeads = [];

  try {
    if (currentUser && currentUser.id) {
      // Corrected Column Names: checks submitted_by or assigned_to matching the user's ID
      const { data, error } = await supabaseClient
        .from('sales_leads')
        .select('*')
        .or(`submitted_by.eq.${currentUser.id},assigned_to.eq.${currentUser.id}`)
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth);

      if (error) {
        console.warn("Date range query warning, falling back to all user records:", error);
        const { data: fallbackData } = await supabaseClient
          .from('sales_leads')
          .select('*')
          .or(`submitted_by.eq.${currentUser.id},assigned_to.eq.${currentUser.id}`);

        monthLeads = fallbackData || [];
      } else {
        monthLeads = data || [];
      }
    }
  } catch (err) {
    console.error("Error fetching sales_leads:", err);
  }

  // Count meetings by date
  const meetingCountsByDay = {};
  monthLeads.forEach(lead => {
    const rawDate = lead.created_at || lead.assigned_at;
    if (rawDate) {
      const dateKey = new Date(rawDate).toISOString().split('T')[0];
      meetingCountsByDay[dateKey] = (meetingCountsByDay[dateKey] || 0) + 1;
    }
  });

  // Render Calendar Grid
  grid.innerHTML = '';

  const firstDayIndex = new Date(year, month, 1).getDay(); // Sunday = 0
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  // Blank slots for days before the 1st
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.style.cssText = 'height: 60px; background: #f8fafc; border-radius: 6px; opacity: 0.4;';
    grid.appendChild(emptyCell);
  }

  // Days of the month
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dayString = day < 10 ? `0${day}` : `${day}`;
    const monthString = (month + 1) < 10 ? `0${month + 1}` : `${month + 1}`;
    const dateKey = `${year}-${monthString}-${dayString}`;

    const count = meetingCountsByDay[dateKey] || 0;
    const isToday = day === now.getDate();

    const dayCard = document.createElement('div');
    dayCard.style.cssText = `
      height: 64px;
      padding: 6px;
      border-radius: 8px;
      border: ${isToday ? '2px solid #2563eb' : '1px solid #e2e8f0'};
      background: ${isToday ? '#eff6ff' : '#ffffff'};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    `;

    dayCard.innerHTML = `
      <div style="font-size: 11px; font-weight: ${isToday ? '700' : '600'}; color: ${isToday ? '#2563eb' : '#475569'};">
        ${day}
      </div>
      ${count > 0 ? `
        <div style="background: #dcfce7; color: #15803d; font-size: 10px; font-weight: 700; padding: 2px 4px; border-radius: 4px; text-align: center;">
          ${count} ${count === 1 ? 'Meeting' : 'Meetings'}
        </div>
      ` : '<div style="font-size: 10px; color: #cbd5e1; text-align: center;">-</div>'}
    `;

    grid.appendChild(dayCard);
  }
}

// ==========================================
// FULL EMPLOYEE PROFILE MODAL ENGINE
// ==========================================
let currentSelectedProfileId = null;

async function openEmployeeProfileModal(employeeId) {
  currentSelectedProfileId = employeeId;
  
  // Resolve active Supabase client instance safely
  const db = (typeof supabase !== 'undefined' && supabase.from) 
    ? supabase 
    : (typeof _supabase !== 'undefined' && _supabase.from) 
      ? _supabase 
      : window.supabaseClient || window.supabase;

  if (!db || typeof db.from !== 'function') {
    console.error('Supabase client is not properly initialized.');
    alert('Database client error. Please check browser console.');
    return;
  }

  // 1. Fetch user profile record
  const { data: emp, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', employeeId)
    .single();

  if (error || !emp) {
    alert('Unable to load employee profile.');
    console.error('Error fetching profile:', error);
    return;
  }

  // 2. Populate Modal Header
  const nameEl = document.getElementById('modal-emp-name');
  const roleEl = document.getElementById('modal-emp-role');
  const emailEl = document.getElementById('modal-emp-email');
  const avatarEl = document.getElementById('modal-emp-avatar');

  if (nameEl) nameEl.innerText = emp.full_name || 'N/A';
  if (roleEl) roleEl.innerText = (emp.role || 'STAFF').toUpperCase();
  if (emailEl) emailEl.innerText = emp.email || '';
  if (avatarEl) {
    avatarEl.src = emp.avatar_url || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='%23cbd5e1'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";
  }

  // 3. Populate Tab 1: Info Details
  const detailName = document.getElementById('profile-detail-name');
  const detailEmail = document.getElementById('profile-detail-email');
  const detailPhone = document.getElementById('profile-detail-phone');
  const detailRole = document.getElementById('profile-detail-role');
  const detailJoin = document.getElementById('profile-detail-join-date');

  if (detailName) detailName.innerText = emp.full_name || '--';
  if (detailEmail) detailEmail.innerText = emp.email || '--';
  if (detailPhone) detailPhone.innerText = emp.mobile || emp.phone || 'No phone recorded';
  if (detailRole) detailRole.innerText = (emp.role || '--').toUpperCase();
  if (detailJoin) detailJoin.innerText = emp.created_at ? new Date(emp.created_at).toLocaleDateString() : '--';

  // 4. Populate Tab 3: Base Salary
 // 4. Populate Tab 3: Base Salary
  const salaryEl = document.getElementById('profile-base-salary');
  if (salaryEl) {
    const salaryVal = emp.base_salary_pkr || emp.base_salary || 0;
    salaryEl.innerText = salaryVal ? `PKR ${Number(salaryVal).toLocaleString()}` : 'PKR --';
  }

  // 5. Default tab switch and display modal
  switchProfileTab('info');
  const modal = document.getElementById('employee-profile-modal');
  if (modal) modal.style.display = 'flex';
}
function closeEmployeeProfileModal() {
  const modal = document.getElementById('employee-profile-modal');
  if (modal) modal.style.display = 'none';
  currentSelectedProfileId = null;
}

function switchProfileTab(tabName) {
  // Hide all tab content panes
  document.querySelectorAll('.profile-tab-content').forEach(el => el.style.display = 'none');

  // Deactivate tab header buttons
  document.querySelectorAll('.modal-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));

  // Show target content
  const target = document.getElementById(`tab-content-${tabName}`);
  if (target) target.style.display = 'block';

  // Highlight active tab
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  }

  // If switching to Attendance tab, trigger calendar fetch
  if (tabName === 'attendance' && currentSelectedProfileId) {
    const monthPicker = document.getElementById('profile-attendance-month');
    if (monthPicker && !monthPicker.value) {
      const now = new Date();
      monthPicker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    loadEmployeeAttendanceTab();
  }
}

async function loadEmployeeAttendanceTab() {
  const monthPicker = document.getElementById('profile-attendance-month');
  const gridContainer = document.getElementById('profile-attendance-calendar-grid');
  
  if (!currentSelectedProfileId || !monthPicker || !gridContainer) return;

  const db = (typeof supabase !== 'undefined' && supabase.from) 
    ? supabase 
    : (typeof _supabase !== 'undefined' && _supabase.from) 
      ? _supabase 
      : window.supabaseClient || window.supabase;
  
  const selectedMonth = monthPicker.value;
  gridContainer.innerHTML = '<div style="grid-column: span 7; text-align: center; padding: 20px; color: #64748b;">Loading attendance records...</div>';

  const { data: records, error } = await db
    .from('attendance')
    .select('*')
    .eq('user_id', currentSelectedProfileId)
    .gte('shift_date', `${selectedMonth}-01`)
    .lte('shift_date', `${selectedMonth}-31`);

  if (error) {
    console.error('Error fetching attendance:', error);
    gridContainer.innerHTML = '<div style="grid-column: span 7; text-align: center; color: red;">Failed to load attendance history.</div>';
    return;
  }

  let html = '';
  if (!records || records.length === 0) {
    html = '<div style="grid-column: span 7; text-align: center; padding: 20px; color: #64748b;">No attendance records found for this month.</div>';
  } else {
    records.forEach(rec => {
      const statusColor = rec.status === 'present' ? '#16a34a' : (rec.status === 'late' ? '#d97706' : '#dc2626');
      html += `
        <div style="border: 1px solid #e2e8f0; padding: 8px; border-radius: 6px; text-align: center; font-size: 0.8rem; background: #ffffff;">
          <div style="font-weight: bold; color: #0f172a;">${rec.shift_date}</div>
          <div style="margin-top: 4px; font-weight: 600; color: ${statusColor};">
            ${(rec.status || 'OFF').toUpperCase()}
          </div>
        </div>
      `;
    });
  }

  gridContainer.innerHTML = html;
}

// ==========================================
// RECRUITMENT (CANDIDATES) — HR / ADMIN ONLY
// Data comes from the WhatsApp CV intake pipeline (public.candidates).
// Access is enforced by RLS (see candidates_security.sql); the checks here
// only control what the UI shows.
// ==========================================
const CANDIDATE_STATUSES = ['new', 'shortlisted', 'interview', 'rescheduled', 'hired', 'rejected'];
const CANDIDATE_ROLES = ['Sales', 'Account Manager', 'Designer', 'Developer', 'HR'];
const CANDIDATE_BUCKET = 'candidate-cvs';

let rawCandidates = []; // Global memory store for instant local search/filtering
let candidateEditTargetId = null;
let candidateChatId = null;
let candidateChatLoadToken = 0;
let candidateMessageTimer = null;
let recruitmentRealtimeChannel = null;
let candidateChatRealtimeChannel = null;
let candidateChatPollTimer = null;
let candidateChatSyncInFlight = false;
let candidateChatInitialLoadComplete = false;
let candidateChatRealtimeSubscribed = false;
let candidateChatOldestCursor = null;
let candidateChatHasOlder = false;
let candidateChatOlderLoading = false;
let recruitmentVisibilityListenerInstalled = false;
let candidateNextCursor = null;
let candidateHasMore = false;
let candidatePageLoading = false;

const CANDIDATE_PAGE_SIZE = 50;
const CANDIDATE_CHAT_PAGE_SIZE = 100;
const CANDIDATE_CHAT_POLL_MS = 5000;

function isRecruitmentUser() {
  return !!currentUser && (currentUser.role === 'hr' || currentUser.role === 'admin');
}

function showCandidatesMessage(text, type) {
  const box = document.getElementById('candidates-message');
  if (!box) return;
  const isError = type === 'error';
  box.textContent = text;
  box.style.display = 'block';
  box.style.background = isError ? '#fee2e2' : '#dcfce7';
  box.style.color = isError ? '#b91c1c' : '#15803d';
  box.style.border = isError ? '1px solid #fecaca' : '1px solid #bbf7d0';
  clearTimeout(candidateMessageTimer);
  candidateMessageTimer = setTimeout(() => { box.style.display = 'none'; }, isError ? 8000 : 4000);
}

function setupRecruitmentRealtimeSync() {
  if (!isRecruitmentUser() || recruitmentRealtimeChannel) return;

  if (!recruitmentVisibilityListenerInstalled) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !isRecruitmentUser()) return;
      const portal = document.getElementById('recruitment-portal');
      if (portal && portal.style.display !== 'none') loadCandidatesData();
      if (candidateChatId && candidateChatInitialLoadComplete) {
        syncCandidateChatAfterReconnect(candidateChatId).catch(error => {
          console.error('Could not sync chat after returning to the tab:', error);
          showCandidateChatError(`Chat sync failed: ${error.message || 'Unknown error'}`);
        });
      }
    });
    recruitmentVisibilityListenerInstalled = true;
  }

  recruitmentRealtimeChannel = supabaseClient.channel('recruitment-live-sync');
  recruitmentRealtimeChannel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'candidates' }, handleCandidateRealtimeChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidate_messages' }, (payload) => {
      if (!isRecruitmentUser() || !payload.new?.candidate_id) return;
      updateCandidateMessagePreview(payload.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.info('Recruitment Realtime connected.');
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        console.warn('Recruitment realtime subscription status:', status);
        showCandidatesMessage('Live recruitment updates are unavailable. Check that the Realtime setup SQL has been run.', 'error');
      }
    });
}

function handleCandidateRealtimeChange(payload) {
  if (!isRecruitmentUser()) return;

  if (payload.eventType === 'INSERT' && payload.new?.id) {
    const candidate = payload.new;
    if (rawCandidates.some(item => item.id === candidate.id)) return;
    rawCandidates.unshift(candidate);
    prependCandidateRow(candidate);
    renderCandidateCounts();
    return;
  }

  if (payload.eventType === 'UPDATE' && payload.new?.id) {
    const index = rawCandidates.findIndex(item => item.id === payload.new.id);
    if (index === -1) return;

    const updatedCandidate = { ...rawCandidates[index], ...payload.new };
    updatedCandidate.last_message_preview = rawCandidates[index].last_message_preview || '';
    rawCandidates.splice(index, 1);
    rawCandidates.unshift(updatedCandidate);
    updateCandidateRow(updatedCandidate);
    renderCandidateCounts();
    return;
  }

  if (payload.eventType === 'DELETE' && payload.old?.id) {
    rawCandidates = rawCandidates.filter(item => item.id !== payload.old.id);
    findCandidateRow(payload.old.id)?.remove();
    renderCandidateCounts();
  }
}

function setupCandidateChatRealtime(candidateId) {
  if (candidateChatRealtimeChannel && candidateChatId === candidateId) return;
  if (candidateChatRealtimeChannel) supabaseClient.removeChannel(candidateChatRealtimeChannel);
  candidateChatRealtimeChannel = null;
  if (!isRecruitmentUser() || !candidateId) return;
  candidateChatRealtimeSubscribed = false;

  candidateChatRealtimeChannel = supabaseClient
    .channel(`candidate-chat-${candidateId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'candidate_messages',
      filter: `candidate_id=eq.${candidateId}`,
    }, (payload) => {
      if (candidateChatId !== candidateId || !payload.new?.id) return;
      appendCandidateChatMessage(payload.new).catch(error => {
        console.error('Could not append realtime candidate message:', error);
        showCandidateChatError(`Could not display new message: ${error.message || 'Unknown error'}`);
      });
    })
    .subscribe((status) => {
      if (candidateChatId !== candidateId) return;
      if (status === 'SUBSCRIBED') {
        candidateChatRealtimeSubscribed = true;
        document.getElementById('candidate-chat-error').style.display = 'none';
        if (candidateChatInitialLoadComplete) {
          syncCandidateChatAfterReconnect(candidateId).catch(error => {
            console.error('Could not sync chat after reconnect:', error);
            showCandidateChatError(`Chat reconnect sync failed: ${error.message || 'Unknown error'}`);
          });
        }
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        console.error('Candidate chat realtime connection status:', status);
        showCandidateChatError(`Live chat connection ${status.toLowerCase().replace('_', ' ')}. Reconnecting...`);
      } else {
        console.warn('Candidate chat realtime subscription status:', status);
      }
    });
}

function formatCandidateDate(raw) {
  if (!raw) return '--';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

async function loadCandidatesData() {
  const tbody = document.getElementById('candidates-table-body');
  if (!tbody) return;

  if (!isRecruitmentUser()) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: #ef4444;">You do not have access to Recruitment.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-muted);">Loading candidates...</td></tr>';
  rawCandidates = [];
  candidateNextCursor = null;
  candidateHasMore = false;
  updateCandidateLoadMoreButton();

  try {
    const { data, error } = await supabaseClient
      .from('candidates')
      .select('id, full_name, phone_number, cv_phone, email, primary_skills, hr_comments, applied_role, cv_storage_path, cv_file_name, status, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CANDIDATE_PAGE_SIZE);

    if (error) throw error;

    rawCandidates = data || [];
    candidateNextCursor = rawCandidates.length
      ? { created_at: rawCandidates[rawCandidates.length - 1].created_at, id: rawCandidates[rawCandidates.length - 1].id }
      : null;
    candidateHasMore = rawCandidates.length === CANDIDATE_PAGE_SIZE;
    filterCandidates();
    updateCandidateLoadMoreButton();
  } catch (err) {
    console.error('Candidates fetch error:', err);
    rawCandidates = [];
    renderCandidateCounts();
    tbody.innerHTML = `<tr><td colspan="8" style="color: var(--accent-red); text-align: center;">Failed to load candidates: ${escapeHtml(err.message || 'Unknown error')}</td></tr>`;
  }
}

async function loadMoreCandidates() {
  if (candidatePageLoading || !candidateHasMore || !candidateNextCursor || !isRecruitmentUser()) return;

  candidatePageLoading = true;
  updateCandidateLoadMoreButton();
  try {
    const cursor = candidateNextCursor;
    const { data, error } = await supabaseClient
      .from('candidates')
      .select('id, full_name, phone_number, cv_phone, email, primary_skills, hr_comments, applied_role, cv_storage_path, cv_file_name, status, created_at')
      .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CANDIDATE_PAGE_SIZE);
    if (error) throw error;

    const existingIds = new Set(rawCandidates.map(candidate => candidate.id));
    const nextPage = (data || []).filter(candidate => !existingIds.has(candidate.id));
    rawCandidates.push(...nextPage);
    if (data?.length) {
      const last = data[data.length - 1];
      candidateNextCursor = { created_at: last.created_at, id: last.id };
    }
    candidateHasMore = (data || []).length === CANDIDATE_PAGE_SIZE;

    const tbody = document.getElementById('candidates-table-body');
    const filteredPage = nextPage.filter(candidateMatchesCurrentFilters);
    if (tbody && filteredPage.length) {
      tbody.querySelector('.candidate-empty-row')?.remove();
      filteredPage.forEach(candidate => tbody.appendChild(createCandidateRow(candidate)));
    }
    renderCandidateCounts();
  } catch (error) {
    console.error('Could not load more candidates:', error);
    showCandidatesMessage(`Could not load more candidates: ${error.message || 'Unknown error'}`, 'error');
  } finally {
    candidatePageLoading = false;
    updateCandidateLoadMoreButton();
  }
}

function updateCandidateLoadMoreButton() {
  const button = document.getElementById('candidates-load-more');
  if (!button) return;
  button.style.display = candidateHasMore ? 'inline-block' : 'none';
  button.disabled = candidatePageLoading;
  button.textContent = candidatePageLoading ? 'Loading...' : 'Load More';
}

function updateCandidateChatLoadOlderButton() {
  const button = document.getElementById('candidate-chat-load-older');
  if (!button) return;
  button.style.display = candidateChatHasOlder ? 'inline-block' : 'none';
  button.disabled = candidateChatOlderLoading;
  button.textContent = candidateChatOlderLoading ? 'Loading...' : 'Load earlier messages';
}

function renderCandidateCounts() {
  const container = document.getElementById('candidates-counts');
  if (!container) return;

  const activeFilter = document.getElementById('candidates-status-filter')?.value || 'all';
  const counts = { all: rawCandidates.length };
  CANDIDATE_STATUSES.forEach(s => { counts[s] = 0; });
  rawCandidates.forEach(c => {
    if (counts[c.status] !== undefined) counts[c.status] += 1;
  });

  const keys = ['all', ...CANDIDATE_STATUSES];
  container.innerHTML = keys.map(key => {
    const isActive = activeFilter === key;
    return `<button type="button" class="btn-secondary" style="padding: 0.25rem 0.7rem; font-size: 0.75rem; border-radius: 999px; ${isActive ? 'background: #2563eb; color: #ffffff;' : ''}" onclick="setCandidateStatusFilter('${key}')">${key.toUpperCase()} (${counts[key]})</button>`;
  }).join('');
}

function setCandidateStatusFilter(status) {
  const select = document.getElementById('candidates-status-filter');
  if (select) select.value = status;
  filterCandidates();
}

function filterCandidates() {
  const filtered = rawCandidates.filter(candidateMatchesCurrentFilters);

  renderCandidateCounts();
  renderCandidatesTable(filtered);
}

function candidateMatchesCurrentFilters(c) {
  const searchTerm = (document.getElementById('candidates-search')?.value || '').toLowerCase().trim();
  const searchDigits = searchTerm.replace(/\D/g, '');
  const selectedStatus = document.getElementById('candidates-status-filter')?.value || 'all';
  const selectedRole = document.getElementById('candidates-role-filter')?.value || 'all';

  const nameMatch = (c.full_name || '').toLowerCase().includes(searchTerm);
  const skillsMatch = (c.primary_skills || '').toLowerCase().includes(searchTerm);
  const phoneMatch = searchDigits.length > 0 &&
    (String(c.phone_number || '').includes(searchDigits) || String(c.cv_phone || '').includes(searchDigits));
  const matchesSearch = !searchTerm || nameMatch || skillsMatch || phoneMatch;
  const matchesStatus = selectedStatus === 'all' || c.status === selectedStatus;
  const matchesRole = selectedRole === 'all' ||
    (selectedRole === '__none__' ? !c.applied_role : c.applied_role === selectedRole);
  return matchesSearch && matchesStatus && matchesRole;
}

function renderCandidatesTable(candidates) {
  const tbody = document.getElementById('candidates-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (candidates.length === 0) {
    const message = rawCandidates.length === 0
      ? 'No candidates yet. CVs sent to the business WhatsApp number will appear here.'
      : 'No candidates match your search or filter.';
    tbody.innerHTML = `<tr class="candidate-empty-row"><td colspan="8" style="text-align:center; color: #94a3b8; padding: 1rem;">${message}</td></tr>`;
    return;
  }

  candidates.forEach(candidate => {
    tbody.appendChild(createCandidateRow(candidate));
  });
}

function findCandidateRow(candidateId) {
  return Array.from(document.querySelectorAll('#candidates-table-body tr[data-candidate-id]'))
    .find(row => row.dataset.candidateId === String(candidateId)) || null;
}

function prependCandidateRow(candidate) {
  const tbody = document.getElementById('candidates-table-body');
  if (!tbody || !candidateMatchesCurrentFilters(candidate)) return;
  tbody.querySelector('.candidate-empty-row')?.remove();
  const existingRow = findCandidateRow(candidate.id);
  if (existingRow) existingRow.remove();
  tbody.prepend(createCandidateRow(candidate));
}

function updateCandidateRow(candidate) {
  const existingRow = findCandidateRow(candidate.id);
  if (!candidateMatchesCurrentFilters(candidate)) {
    existingRow?.remove();
    return;
  }

  const tbody = document.getElementById('candidates-table-body');
  if (!tbody) return;
  tbody.querySelector('.candidate-empty-row')?.remove();
  const updatedRow = createCandidateRow(candidate);
  if (existingRow) existingRow.replaceWith(updatedRow);
  tbody.prepend(updatedRow);
}

function createCandidateRow(c) {
    const cleanName = escapeHtml(c.full_name || 'Unnamed');
    const cleanPhone = escapeHtml(String(c.phone_number || '--'));
    const skillsText = (c.primary_skills || '').trim();
    const skillsPending = !skillsText || skillsText.toLowerCase() === 'pending review';
    const cleanSkills = skillsPending
      ? '<span style="color: #94a3b8; font-style: italic;">Pending review \u2014 click to add</span>'
      : escapeHtml(skillsText);
    const cvPhoneDigits = String(c.cv_phone || '').replace(/\D/g, '');
    const waPhoneDigits = String(c.phone_number || '').replace(/\D/g, '');
    const cvPhoneLine = cvPhoneDigits && cvPhoneDigits !== waPhoneDigits
      ? `<div style="font-size: 0.72rem; color: #64748b;">On CV: ${escapeHtml(cvPhoneDigits)}</div>`
      : '';
    const currentRole = CANDIDATE_ROLES.includes(c.applied_role) ? c.applied_role : '';
    const cleanFile = escapeHtml(c.cv_file_name || '--');
    const currentStatus = CANDIDATE_STATUSES.includes(c.status) ? c.status : 'new';
    const hasCv = !!c.cv_storage_path;
    const hasPhone = String(c.phone_number || '').replace(/\D/g, '').length > 0;

    const row = document.createElement('tr');
    row.dataset.candidateId = String(c.id);
    row.innerHTML = `
      <td><strong>${cleanName}</strong>${c.email ? `<div style="font-size: 0.75rem; color: #64748b; word-break: break-all;">${escapeHtml(c.email)}</div>` : ''}${c.last_message_preview ? `<div class="candidate-last-message" style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem;">${escapeHtml(c.last_message_preview)}</div>` : ''}</td>
      <td>${cleanPhone}${cvPhoneLine}</td>
      <td>
        <select class="form-select candidate-role-select" aria-label="Role for ${cleanName}" onchange="updateCandidateRole('${c.id}', this)">
          <option value="" ${currentRole === '' ? 'selected' : ''}>-- Set role --</option>
          ${CANDIDATE_ROLES.map(r => `<option value="${escapeHtml(r)}" ${currentRole === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
        </select>
      </td>
      <td class="candidate-skills-cell" title="${skillsPending ? 'Pending review' : escapeHtml(skillsText)}; click to edit skills" onclick="openCandidateEditModal('${c.id}', 'skills')"><span class="candidate-skills">${cleanSkills}</span></td>
      <td class="candidate-status-cell">
        <select class="form-select candidate-status-select status-${currentStatus}" aria-label="Status for ${cleanName}" onchange="updateCandidateStatus('${c.id}', this)">
          ${CANDIDATE_STATUSES.map(s => `<option value="${s}" ${currentStatus === s ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}
        </select>
      </td>
      <td class="candidate-file-cell" title="${cleanFile}">${cleanFile}</td>
      <td style="white-space: nowrap;">${escapeHtml(formatCandidateDate(c.created_at))}</td>
      <td>
        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
          <button class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" ${hasCv ? '' : 'disabled title="No CV file stored"'} onclick="viewCandidateCv('${c.id}')">View CV</button>
          <button class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="openCandidateChat('${c.id}')">Chat</button>
          <button class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" ${hasPhone ? '' : 'disabled'} onclick="openCandidateWhatsApp('${c.id}')">WhatsApp</button>
          <button class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="openCandidateEditModal('${c.id}')">Edit</button>
        </div>
      </td>
    `;
    return row;
}

function updateCandidateMessagePreview(message) {
  const candidate = rawCandidates.find(item => item.id === message.candidate_id);
  if (!candidate) return;

  candidate.last_message_preview = message.text_body || message.caption || message.message_type || 'New WhatsApp message';
  candidate.last_message_timestamp = message.message_timestamp || new Date().toISOString();
  updateCandidateRow(candidate);
}

async function viewCandidateCv(candidateId) {
  const candidate = rawCandidates.find(c => c.id === candidateId);
  if (!candidate || !candidate.cv_storage_path) {
    showCandidatesMessage('No CV file is stored for this candidate.', 'error');
    return;
  }

  // Open the tab synchronously (inside the click) so popup blockers allow it,
  // then point it at the signed URL once we have it.
  const win = window.open('about:blank', '_blank');
  if (win) win.opener = null;

  const { data, error } = await supabaseClient.storage
    .from(CANDIDATE_BUCKET)
    .createSignedUrl(candidate.cv_storage_path, 60);

  if (error || !data?.signedUrl) {
    if (win) win.close();
    showCandidatesMessage(`Could not open CV: ${error?.message || 'no URL returned'}`, 'error');
    return;
  }

  if (win) {
    win.location.href = data.signedUrl;
  } else {
    showCandidatesMessage('Your browser blocked the new tab. Allow pop-ups for this site and try again.', 'error');
  }
}

function openCandidateWhatsApp(candidateId) {
  const candidate = rawCandidates.find(c => c.id === candidateId);
  const digits = String(candidate?.phone_number || '').replace(/\D/g, '');
  if (!digits) {
    showCandidatesMessage('No valid phone number for this candidate.', 'error');
    return;
  }
  window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
}

function openCandidateChat(candidateId) {
  const candidate = rawCandidates.find(c => c.id === candidateId);
  if (!candidate || !isRecruitmentUser()) {
    showCandidatesMessage('You do not have access to this candidate chat.', 'error');
    return;
  }

  if (candidateChatId !== candidateId && candidateChatRealtimeChannel) {
    supabaseClient.removeChannel(candidateChatRealtimeChannel);
    candidateChatRealtimeChannel = null;
  }
  stopCandidateChatPolling();
  candidateChatInitialLoadComplete = false;
  candidateChatOldestCursor = null;
  candidateChatHasOlder = false;
  candidateChatOlderLoading = false;
  updateCandidateChatLoadOlderButton();
  candidateChatId = candidateId;
  document.getElementById('candidate-chat-title').textContent = candidate.full_name || 'Candidate';
  document.getElementById('candidate-chat-subtitle').textContent = candidate.phone_number || '';
  document.getElementById('candidate-chat-modal').style.display = 'flex';
  document.getElementById('candidate-chat-error').style.display = 'none';
  setupCandidateChatRealtime(candidateId);
  startCandidateChatPolling(candidateId);
  document.getElementById('candidate-chat-reply-input').focus();
  loadCandidateChat();
}

function startCandidateChatPolling(candidateId) {
  stopCandidateChatPolling();
  candidateChatPollTimer = window.setInterval(() => {
    if (
      document.hidden ||
      candidateChatId !== candidateId ||
      !candidateChatInitialLoadComplete ||
      candidateChatSyncInFlight
    ) return;

    syncCandidateChatAfterReconnect(candidateId).catch(error => {
      console.error('Candidate chat background sync failed:', error);
      showCandidateChatError(`Could not check for new messages: ${error.message || 'Unknown error'}`);
    });
  }, CANDIDATE_CHAT_POLL_MS);
}

function stopCandidateChatPolling() {
  if (candidateChatPollTimer !== null) {
    window.clearInterval(candidateChatPollTimer);
    candidateChatPollTimer = null;
  }
}

function closeCandidateChat() {
  stopCandidateChatPolling();
  candidateChatId = null;
  candidateChatLoadToken++;
  candidateChatInitialLoadComplete = false;
  candidateChatRealtimeSubscribed = false;
  candidateChatOldestCursor = null;
  candidateChatHasOlder = false;
  candidateChatOlderLoading = false;
  if (candidateChatRealtimeChannel) {
    supabaseClient.removeChannel(candidateChatRealtimeChannel);
    candidateChatRealtimeChannel = null;
  }
  document.getElementById('candidate-chat-modal').style.display = 'none';
  updateCandidateChatLoadOlderButton();
}

function showCandidateChatError(message) {
  const errorBox = document.getElementById('candidate-chat-error');
  errorBox.textContent = message;
  errorBox.style.display = 'block';
}

function candidateMessageContent(message, signedUrl) {
  const parts = [];
  if (message.text_body) {
    parts.push(`<div class="candidate-chat-text">${escapeHtml(message.text_body)}</div>`);
  }
  if (message.caption && message.caption !== message.text_body) {
    parts.push(`<div class="candidate-chat-text">${escapeHtml(message.caption)}</div>`);
  }
  if (signedUrl && message.media_mime_type?.startsWith('image/')) {
    parts.push(`<a href="${escapeHtml(signedUrl)}" target="_blank" rel="noopener noreferrer"><img class="candidate-chat-image" src="${escapeHtml(signedUrl)}" alt="${escapeHtml(message.media_file_name || 'WhatsApp image')}"></a>`);
  } else if (signedUrl) {
    parts.push(`<a class="candidate-chat-attachment" href="${escapeHtml(signedUrl)}" target="_blank" rel="noopener noreferrer">Download ${escapeHtml(message.media_file_name || message.message_type || 'attachment')}</a>`);
  } else if (message.media_id) {
    parts.push('<div class="candidate-chat-media-unavailable">Attachment could not be downloaded.</div>');
  }
  if (!parts.length) {
    parts.push(`<div class="candidate-chat-text">${escapeHtml(message.message_type || 'Message')}</div>`);
  }
  return parts.join('');
}

async function createCandidateChatBubble(message) {
  let signedUrl = null;
  if (message.media_storage_path) {
    const { data, error } = await supabaseClient.storage
      .from('candidate-chat-media')
      .createSignedUrl(message.media_storage_path, 300);
    if (error) throw error;
    signedUrl = data?.signedUrl || null;
  }

  const direction = message.direction === 'outbound' ? 'outbound' : 'inbound';
  const status = message.delivery_status ? ` · ${escapeHtml(message.delivery_status)}` : '';
  const bubble = document.createElement('article');
  bubble.className = `candidate-chat-bubble ${direction}`;
  bubble.dataset.messageId = String(message.id);
  bubble.dataset.messageTimestamp = message.message_timestamp || '';
  bubble.innerHTML = `
    ${candidateMessageContent(message, signedUrl)}
    <div class="candidate-chat-meta">${escapeHtml(formatCandidateDate(message.message_timestamp))}${status}</div>`;
  return bubble;
}

async function appendCandidateChatMessage(message) {
  const messagesContainer = document.getElementById('candidate-chat-messages');
  if (!messagesContainer || !message?.id) return;

  const messageId = String(message.id);
  if (Array.from(messagesContainer.querySelectorAll('[data-message-id]'))
    .some(element => element.dataset.messageId === messageId)) return;

  const wasNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 80;
  const bubble = await createCandidateChatBubble(message);
  if (candidateChatId !== message.candidate_id) return;
  if (Array.from(messagesContainer.querySelectorAll('[data-message-id]'))
    .some(element => element.dataset.messageId === messageId)) return;

  messagesContainer.querySelector('.candidate-chat-state')?.remove();
  messagesContainer.appendChild(bubble);
  sortCandidateChatMessages();
  if (wasNearBottom) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sortCandidateChatMessages() {
  const messagesContainer = document.getElementById('candidate-chat-messages');
  if (!messagesContainer) return;
  const bubbles = Array.from(messagesContainer.querySelectorAll('[data-message-id]'));
  bubbles.sort((left, right) => {
    const timeDifference = Date.parse(left.dataset.messageTimestamp || '') -
      Date.parse(right.dataset.messageTimestamp || '');
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
    return left.dataset.messageId.localeCompare(right.dataset.messageId);
  });
  bubbles.forEach(bubble => messagesContainer.appendChild(bubble));
}

async function syncCandidateChatAfterReconnect(candidateId) {
  if (candidateId !== candidateChatId || candidateChatSyncInFlight) return;
  candidateChatSyncInFlight = true;
  try {
    await syncCandidateChatMessagesSinceLatest(candidateId);
  } finally {
    candidateChatSyncInFlight = false;
  }
}

async function syncCandidateChatMessagesSinceLatest(candidateId) {
  if (candidateId !== candidateChatId) return;
  const messagesContainer = document.getElementById('candidate-chat-messages');
  const timestamps = Array.from(messagesContainer.querySelectorAll('[data-message-timestamp]'))
    .map(element => element.dataset.messageTimestamp)
    .filter(Boolean)
    .sort();
  const latestTimestamp = timestamps[timestamps.length - 1];

  let cursor = null;
  while (candidateId === candidateChatId) {
    let query = supabaseClient
      .from('candidate_messages')
      .select('id, candidate_id, direction, message_type, text_body, caption, media_id, media_mime_type, media_file_name, media_storage_path, delivery_status, message_timestamp')
      .eq('candidate_id', candidateId)
      .order('message_timestamp', { ascending: true })
      .order('id', { ascending: true })
      .limit(CANDIDATE_CHAT_PAGE_SIZE);
    if (cursor) {
      query = query.or(
        `message_timestamp.gt.${cursor.message_timestamp},and(message_timestamp.eq.${cursor.message_timestamp},id.gt.${cursor.id})`,
      );
    } else if (latestTimestamp) {
      query = query.gte('message_timestamp', latestTimestamp);
    }

    const { data: messages, error } = await query;
    if (error) throw error;
    if (candidateId !== candidateChatId) return;
    for (const message of messages || []) {
      await appendCandidateChatMessage(message);
    }
    if ((messages || []).length < CANDIDATE_CHAT_PAGE_SIZE) return;
    const last = messages[messages.length - 1];
    cursor = { message_timestamp: last.message_timestamp, id: last.id };
  }
}

async function loadOlderCandidateChat() {
  const candidateId = candidateChatId;
  const cursor = candidateChatOldestCursor;
  const messagesContainer = document.getElementById('candidate-chat-messages');
  if (!candidateId || !cursor || !candidateChatHasOlder || candidateChatOlderLoading || !messagesContainer) return;

  candidateChatOlderLoading = true;
  updateCandidateChatLoadOlderButton();
  const previousHeight = messagesContainer.scrollHeight;
  try {
    const { data: messages, error } = await supabaseClient
      .from('candidate_messages')
      .select('id, candidate_id, direction, message_type, text_body, caption, media_id, media_mime_type, media_file_name, media_storage_path, delivery_status, message_timestamp')
      .eq('candidate_id', candidateId)
      .or(`message_timestamp.lt.${cursor.message_timestamp},and(message_timestamp.eq.${cursor.message_timestamp},id.lt.${cursor.id})`)
      .order('message_timestamp', { ascending: false })
      .order('id', { ascending: false })
      .limit(CANDIDATE_CHAT_PAGE_SIZE);
    if (error) throw error;
    if (candidateId !== candidateChatId) return;

    const ascendingMessages = (messages || []).slice().reverse();
    const rendered = await Promise.all(ascendingMessages.map(createCandidateChatBubble));
    if (candidateId !== candidateChatId) return;
    const firstBubble = messagesContainer.querySelector('[data-message-id]');
    rendered.forEach(bubble => {
      if (!Array.from(messagesContainer.querySelectorAll('[data-message-id]'))
        .some(existing => existing.dataset.messageId === bubble.dataset.messageId)) {
        messagesContainer.insertBefore(bubble, firstBubble);
      }
    });

    if (ascendingMessages.length) {
      const oldest = ascendingMessages[0];
      candidateChatOldestCursor = { message_timestamp: oldest.message_timestamp, id: oldest.id };
    }
    candidateChatHasOlder = (messages || []).length === CANDIDATE_CHAT_PAGE_SIZE;
    messagesContainer.scrollTop += messagesContainer.scrollHeight - previousHeight;
  } catch (error) {
    console.error('Could not load earlier candidate chat messages:', error);
    showCandidateChatError(`Could not load earlier messages: ${error.message || 'Unknown error'}`);
  } finally {
    candidateChatOlderLoading = false;
    updateCandidateChatLoadOlderButton();
  }
}

async function loadCandidateChat() {
  const candidateId = candidateChatId;
  if (!candidateId) return;
  const loadToken = ++candidateChatLoadToken;
  const messagesContainer = document.getElementById('candidate-chat-messages');
  const hasExistingMessages = !!messagesContainer.querySelector('[data-message-id]');
  if (!messagesContainer.querySelector('[data-message-id]')) {
    messagesContainer.innerHTML = '<p class="candidate-chat-state">Loading chat history...</p>';
  }
  document.getElementById('candidate-chat-error').style.display = 'none';

  try {
    const { data: newestFirst, error } = await supabaseClient
      .from('candidate_messages')
      .select('id, candidate_id, direction, message_type, text_body, caption, media_id, media_mime_type, media_file_name, media_storage_path, delivery_status, message_timestamp')
      .eq('candidate_id', candidateId)
      .order('message_timestamp', { ascending: false })
      .order('id', { ascending: false })
      .limit(CANDIDATE_CHAT_PAGE_SIZE);
    if (error) throw error;

    const messages = (newestFirst || []).slice().reverse();
    const rendered = await Promise.all((messages || []).map(createCandidateChatBubble));

    if (loadToken !== candidateChatLoadToken || candidateId !== candidateChatId) return;
    const renderedIds = new Set(rendered.map(bubble => bubble.dataset.messageId));
    for (const bubble of rendered) {
      if (!Array.from(messagesContainer.querySelectorAll('[data-message-id]'))
        .some(existing => existing.dataset.messageId === bubble.dataset.messageId)) {
        messagesContainer.appendChild(bubble);
      }
    }
    sortCandidateChatMessages();
    if (!hasExistingMessages) {
      const oldest = messages[0];
      candidateChatOldestCursor = oldest
        ? { message_timestamp: oldest.message_timestamp, id: oldest.id }
        : null;
      candidateChatHasOlder = (newestFirst || []).length === CANDIDATE_CHAT_PAGE_SIZE;
    }
    updateCandidateChatLoadOlderButton();
    candidateChatInitialLoadComplete = true;
    if (!renderedIds.size && !messagesContainer.querySelector('[data-message-id]')) {
      messagesContainer.innerHTML = '<p class="candidate-chat-state">No WhatsApp messages have been recorded for this candidate.</p>';
    } else {
      messagesContainer.querySelector('.candidate-chat-state')?.remove();
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    if (candidateChatRealtimeSubscribed) {
      syncCandidateChatAfterReconnect(candidateId).catch(error => {
        console.error('Could not reconcile chat after initial load:', error);
        showCandidateChatError(`Chat sync failed: ${error.message || 'Unknown error'}`);
      });
    }
  } catch (error) {
    if (loadToken !== candidateChatLoadToken) return;
    console.error('Candidate chat load failed:', error);
    if (!messagesContainer.querySelector('[data-message-id]')) {
      messagesContainer.innerHTML = '<p class="candidate-chat-state">Could not load chat history.</p>';
    }
    showCandidateChatError(`Could not load chat history: ${error.message || 'Unknown error'}`);
  }
}

async function sendCandidateChatReply(event) {
  event.preventDefault();
  if (!candidateChatId || !isRecruitmentUser()) {
    showCandidateChatError('You do not have permission to send a reply.');
    return;
  }

  const input = document.getElementById('candidate-chat-reply-input');
  const sendButton = document.getElementById('candidate-chat-send-btn');
  const text = input.value.trim();
  if (!text) return;

  sendButton.disabled = true;
  sendButton.textContent = 'Sending...';
  document.getElementById('candidate-chat-error').style.display = 'none';
  try {
    const { data, error } = await supabaseClient.functions.invoke('whatsapp-send-reply', {
      body: { candidateId: candidateChatId, text }
    });
    if (error) {
      let detail = error.message || 'Edge Function request failed.';
      if (error.context instanceof Response) {
        const responseText = await error.context.clone().text();
        if (responseText) {
          try {
            const responseBody = JSON.parse(responseText);
            detail = responseBody.details || responseBody.error || detail;
          } catch {
            detail = responseText.slice(0, 500);
          }
        }
        detail = `HTTP ${error.context.status}: ${detail}`;
      }
      throw new Error(detail);
    }
    if (!data?.success) throw new Error(data?.error || 'WhatsApp reply was not confirmed.');
    input.value = '';
    if (data.message) {
      const sentMessage = {
        ...data.message,
        candidate_id: candidateChatId,
        direction: 'outbound',
        message_type: 'text',
        text_body: text,
        delivery_status: 'sent',
      };
      await appendCandidateChatMessage(sentMessage);
      updateCandidateMessagePreview(sentMessage);
    }
  } catch (error) {
    console.error('Candidate WhatsApp reply failed:', error);
    showCandidateChatError(`Could not send reply: ${error.message || 'Unknown error'}`);
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = 'Send';
  }
}

async function updateCandidateStatus(candidateId, selectEl) {
  const candidate = rawCandidates.find(c => c.id === candidateId);
  const newStatus = selectEl.value;
  if (!candidate || !CANDIDATE_STATUSES.includes(newStatus)) return;

  const previousStatus = candidate.status;
  selectEl.disabled = true;

  // .select() lets us detect a silent 0-row update caused by RLS.
  const { data, error } = await supabaseClient
    .from('candidates')
    .update({ status: newStatus })
    .eq('id', candidateId)
    .select('id');

  selectEl.disabled = false;

  if (error || !data || data.length === 0) {
    selectEl.value = previousStatus;
    showCandidatesMessage(`Status update failed: ${error ? error.message : 'not permitted or candidate not found'}`, 'error');
    return;
  }

  candidate.status = newStatus;
  showCandidatesMessage(`Status updated to ${newStatus.toUpperCase()}.`, 'success');
  updateCandidateRow(candidate);
  renderCandidateCounts();
}

async function updateCandidateRole(candidateId, selectEl) {
  const candidate = rawCandidates.find(c => c.id === candidateId);
  const newRole = selectEl.value || null;
  if (!candidate || (newRole && !CANDIDATE_ROLES.includes(newRole))) return;

  const previousRole = candidate.applied_role || '';
  selectEl.disabled = true;

  const { data, error } = await supabaseClient
    .from('candidates')
    .update({ applied_role: newRole })
    .eq('id', candidateId)
    .select('id');

  selectEl.disabled = false;

  if (error || !data || data.length === 0) {
    selectEl.value = previousRole;
    showCandidatesMessage(`Role update failed: ${error ? error.message : 'not permitted or candidate not found'}`, 'error');
    return;
  }

  candidate.applied_role = newRole;
  showCandidatesMessage(newRole ? `Role set to ${newRole}.` : 'Role cleared.', 'success');
  updateCandidateRow(candidate);
  renderCandidateCounts();
}

function openCandidateEditModal(candidateId, focusField) {
  const candidate = rawCandidates.find(c => c.id === candidateId);
  if (!candidate) return;

  candidateEditTargetId = candidateId;
  document.getElementById('cand-edit-name').value = candidate.full_name || '';
  document.getElementById('cand-edit-email').value = candidate.email || '';
  const existingSkills = (candidate.primary_skills || '').trim();
  document.getElementById('cand-edit-skills').value =
    existingSkills.toLowerCase() === 'pending review' ? '' : existingSkills;
  document.getElementById('cand-edit-hr-comments').value = candidate.hr_comments || '';
  document.getElementById('candidate-edit-modal').style.display = 'flex';
  const focusEl = document.getElementById(focusField === 'skills' ? 'cand-edit-skills' : 'cand-edit-name');
  if (focusEl) setTimeout(() => focusEl.focus(), 0);
}

function closeCandidateEditModal() {
  document.getElementById('candidate-edit-modal').style.display = 'none';
  candidateEditTargetId = null;
}

async function saveCandidateEdit(e) {
  e.preventDefault();
  if (!candidateEditTargetId) return;

  const candidate = rawCandidates.find(c => c.id === candidateEditTargetId);
  const btn = document.getElementById('cand-edit-save-btn');
  const payload = {
    full_name: document.getElementById('cand-edit-name').value.trim(),
    email: document.getElementById('cand-edit-email').value.trim() || null,
    primary_skills: document.getElementById('cand-edit-skills').value.trim() || 'Pending Review',
    hr_comments: document.getElementById('cand-edit-hr-comments').value.trim() || null
  };

  if (!payload.full_name) {
    showCandidatesMessage('Full name is required.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const { data, error } = await supabaseClient
      .from('candidates')
      .update(payload)
      .eq('id', candidateEditTargetId)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Not permitted or candidate not found.');

    if (candidate) Object.assign(candidate, payload);
    closeCandidateEditModal();
    showCandidatesMessage('Candidate details saved.', 'success');
    if (candidate) updateCandidateRow(candidate);
    renderCandidateCounts();
  } catch (err) {
    showCandidatesMessage(`Could not save candidate: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}