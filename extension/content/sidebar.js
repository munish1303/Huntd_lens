import { generateTemplate } from '../utils/templates.js';

const SIDEBAR_ID = 'huntd-lens-sidebar';

function getSidebar() {
  return document.getElementById(SIDEBAR_ID);
}

function setSidebarContent(html) {
  const sidebar = getSidebar();
  if (sidebar) sidebar.innerHTML = html;
}

function bindClose() {
  document.querySelector(`#${SIDEBAR_ID} .huntd-close`)
    ?.addEventListener('click', () => destroySidebar());
}

function getInitials(fullName = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return (`${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`).toUpperCase() || 'HL';
}

function scoreClass(label = '') {
  if (label === 'Hot')  return 'huntd-score-ring--hot';
  if (label === 'Warm') return 'huntd-score-ring--warm';
  return 'huntd-score-ring--cold';
}

function barWidth(value, max) {
  return `${Math.min(Math.round((value / max) * 100), 100)}%`;
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${months[d.getMonth()]} ${d.getDate()}, ${h}:${m} ${ampm}`;
  } catch (_e) { return ''; }
}

function header() {
  return `
    <div class="huntd-header">
      <div class="huntd-brand-wrap">
        <span class="huntd-eyebrow">Huntd Lens</span>
        <span class="huntd-brand">Lead Intel</span>
      </div>
      <button class="huntd-close" type="button" aria-label="Close">×</button>
    </div>`;
}

export function initSidebar() {
  destroySidebar();
  const sidebar = document.createElement('div');
  sidebar.id = SIDEBAR_ID;
  sidebar.innerHTML = `
    ${header()}
    <div class="huntd-loading">
      <div class="huntd-skeleton huntd-skeleton--xl"></div>
      <div class="huntd-skeleton huntd-skeleton--lg"></div>
      <div class="huntd-skeleton"></div>
      <div class="huntd-skeleton huntd-skeleton--sm"></div>
    </div>`;
  document.body.appendChild(sidebar);
  bindClose();
}

export function updateSidebar(response) {
  const context = window.__HUNTD_LENS_CONTEXT__ || {};
  const profileData = context.profileData || {};

  // ── No API key ────────────────────────────────────────────────────────────
  if (response.error === 'NO_API_KEY') {
    setSidebarContent(`
      ${header()}
      <div class="huntd-state-card">
        <div class="huntd-state-title">API key required</div>
        <div class="huntd-state-msg">Open the extension settings and enter your Huntd API key to get started.</div>
        <button class="huntd-btn huntd-btn--primary huntd-open-settings" type="button">Open Settings</button>
      </div>`);
    bindClose();
    document.querySelector(`#${SIDEBAR_ID} .huntd-open-settings`)
      ?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }));
    return;
  }

  // ── Network error ─────────────────────────────────────────────────────────
  if (response.error === 'NETWORK_ERROR') {
    setSidebarContent(`
      ${header()}
      <div class="huntd-state-card">
        <div class="huntd-state-title">Backend unreachable</div>
        <div class="huntd-state-msg">Could not connect to the Huntd backend. Check that it's running and the URL in settings is correct.</div>
        <button class="huntd-btn huntd-btn--secondary huntd-retry" type="button">Retry</button>
      </div>`);
    bindClose();
    document.querySelector(`#${SIDEBAR_ID} .huntd-retry`)
      ?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('huntd-lens-retry')));
    return;
  }

  // ── Generic error ─────────────────────────────────────────────────────────
  if (!response.success) {
    setSidebarContent(`
      ${header()}
      <div class="huntd-state-card">
        <div class="huntd-state-title">Something went wrong</div>
        <div class="huntd-state-msg">${response.message || 'Unable to load competitor intelligence right now.'}</div>
      </div>`);
    bindClose();
    return;
  }

  // ── Success ───────────────────────────────────────────────────────────────
  const data = response.data;
  const isOffline = Boolean(response.offline);
  const icp = data.icpScore;

  const toolsHtml = data.competitorTools.length > 0
    ? data.competitorTools.map((t) => `<span class="huntd-tool-pill">${t.toolName}</span>`).join('')
    : '<span class="huntd-empty">No competitor tools detected</span>';

  const contacts = data.competitorTools.flatMap((t) => t.contacts).slice(0, 4);
  const contactsHtml = contacts.length > 0
    ? contacts.map((c) => `
        <div class="huntd-contact-row">
          <span class="huntd-contact-dot"></span>
          <span>${c.firstName} ${c.lastName?.[0] ? c.lastName[0] + '.' : ''} — ${c.jobTitle || ''}</span>
        </div>`).join('')
    : '';

  setSidebarContent(`
    ${header()}
    <div class="huntd-body">

      <!-- Profile -->
      <div class="huntd-card huntd-profile">
        <div class="huntd-avatar">${getInitials(data.profile.fullName)}</div>
        <div class="huntd-profile-info">
          <div class="huntd-profile-name">${data.profile.fullName}</div>
          <div class="huntd-profile-role">${data.profile.jobTitle}</div>
          <div class="huntd-profile-company">${data.profile.companyName}</div>
        </div>
      </div>

      <!-- ICP Score -->
      <div class="huntd-card">
        <div class="huntd-section-label">ICP Score</div>
        <div class="huntd-score-card">
          <div class="huntd-score-ring ${scoreClass(icp.label)}">
            <div class="huntd-score-number">${icp.score}</div>
            <div class="huntd-score-label">${icp.label}</div>
          </div>
          <div class="huntd-breakdown">
            <div class="huntd-breakdown-row">
              <span class="huntd-breakdown-label">Activity</span>
              <div class="huntd-bar-track"><div class="huntd-bar-fill" style="width:${barWidth(icp.breakdown.activity, 20)}"></div></div>
            </div>
            <div class="huntd-breakdown-row">
              <span class="huntd-breakdown-label">Title</span>
              <div class="huntd-bar-track"><div class="huntd-bar-fill" style="width:${barWidth(icp.breakdown.jobTitle, 30)}"></div></div>
            </div>
            <div class="huntd-breakdown-row">
              <span class="huntd-breakdown-label">Tenure</span>
              <div class="huntd-bar-track"><div class="huntd-bar-fill" style="width:${barWidth(icp.breakdown.tenure, 20)}"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Competitor tools -->
      <div class="huntd-card">
        <div class="huntd-section-label">Competitor tools detected</div>
        <div class="huntd-tools-wrap">${toolsHtml}</div>
        ${contactsHtml ? `<div class="huntd-contacts">${contactsHtml}</div>` : ''}
      </div>

      <!-- Actions -->
      <div class="huntd-actions">
        <button class="huntd-btn huntd-btn--secondary huntd-copy-template" type="button">Copy template</button>
        <button class="huntd-btn huntd-btn--primary huntd-view-huntd" type="button">View in Huntd →</button>
      </div>

    </div>

    <!-- Footer -->
    <div class="huntd-footer">
      <span class="huntd-footer-ts">${isOffline ? '⚠ Local score' : `Updated ${formatDate(data.fetchedAt)}`}</span>
      <a class="huntd-powered" href="https://gethuntd.com" target="_blank" rel="noreferrer">Powered by Huntd</a>
    </div>`);

  bindClose();

  document.querySelector(`#${SIDEBAR_ID} .huntd-copy-template`)
    ?.addEventListener('click', async (e) => {
      const sizeNums = String(profileData.companySize || '').match(/\d+/g);
      const sizeNum = sizeNums?.length ? Number(sizeNums[0]) : 0;
      const tpl = generateTemplate(
        { fullName: data.profile.fullName, companyName: data.profile.companyName, jobTitle: data.profile.jobTitle, companySize: sizeNum },
        data.competitorTools
      );
      await navigator.clipboard.writeText(tpl);
      const btn = e.currentTarget;
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });

  document.querySelector(`#${SIDEBAR_ID} .huntd-view-huntd`)
    ?.addEventListener('click', () => window.open(data.huntdDashboardUrl, '_blank', 'noopener,noreferrer'));
}

export function destroySidebar() {
  getSidebar()?.remove();
}
