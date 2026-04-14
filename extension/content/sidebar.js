import { generateTemplate } from '../utils/templates.js';

const SIDEBAR_ID = 'huntd-lens-sidebar';

function getSidebar() { return document.getElementById(SIDEBAR_ID); }
function setSidebarContent(html) {
  const s = getSidebar();
  if (s) s.innerHTML = html;
}
function bindClose() {
  document.querySelector(`#${SIDEBAR_ID} .huntd-close`)
    ?.addEventListener('click', () => destroySidebar());
}

// ── Vapor glow: track mouse inside the sidebar ────────────────────────────
function bindVaporGlow() {
  const sidebar = getSidebar();
  if (!sidebar) return;
  let raf = null;
  const pos = { x: 50, y: 30 };

  sidebar.addEventListener('mousemove', (e) => {
    const rect = sidebar.getBoundingClientRect();
    pos.x = ((e.clientX - rect.left) / rect.width)  * 100;
    pos.y = ((e.clientY - rect.top)  / rect.height) * 100;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      sidebar.style.setProperty('--vx', `${pos.x}%`);
      sidebar.style.setProperty('--vy', `${pos.y}%`);
      raf = null;
    });
  }, { passive: true });
}

function getInitials(name = '') {
  const clean = name.replace(/\s*\(Company\)\s*$/i, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return (`${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`).toUpperCase() || 'HL';
}

function scoreClass(label = '') {
  if (label === 'Hot')  return 'huntd-score-number--hot';
  if (label === 'Warm') return 'huntd-score-number--warm';
  return 'huntd-score-number--cold';
}

function barPct(val, max) { return `${Math.min(Math.round((val / max) * 100), 100)}%`; }

function formatDate(iso) {
  try {
    const d = new Date(iso);
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    let h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${mo} ${d.getDate()}, ${h}:${m} ${ap}`;
  } catch { return ''; }
}

function pitchAngle(profileData, competitorTools) {
  const size = Number(String(profileData?.companySize || '').match(/\d+/)?.[0]) || 0;
  const tools = competitorTools?.map(t => t.toolName).filter(Boolean) || [];
  const toolStr = tools.length ? tools.join(', ') : 'their current stack';
  // Sanitise company name — strip anything that looks like scraped noise
  const company = (profileData.companyName || 'This team').replace(/[^a-zA-Z0-9\s\-&.,]/g, '').trim().slice(0, 60) || 'This team';
  if (size < 50)  return `${company} is moving fast. Lead with speed-to-signal and less manual overhead — Huntd replaces ${toolStr} with one clean layer.`;
  if (size < 500) return `Teams scaling outbound at ${company} feel the friction of ${toolStr} before anyone else does. Huntd tightens execution without adding workflow drag.`;
  return `At ${company}, converting signal from ${toolStr} into action is where momentum drops. Huntd keeps reps acting on insight instead of managing it.`;
}

function header(statusText = 'Lead Intel') {
  return `
    <div class="huntd-header">
      <div class="huntd-brand-wrap">
        <span class="huntd-eyebrow">Huntd Lens</span>
        <span class="huntd-brand">${statusText}</span>
      </div>
      <div class="huntd-header-meta">
        <button class="huntd-close" type="button" aria-label="Close">×</button>
      </div>
    </div>`;
}

export function initSidebar() {
  destroySidebar();
  const el = document.createElement('div');
  el.id = SIDEBAR_ID;
  el.innerHTML = `
    ${header('Loading...')}
    <div class="huntd-loading">
      <div class="huntd-skeleton huntd-skeleton--xl"></div>
      <div class="huntd-skeleton huntd-skeleton--lg"></div>
      <div class="huntd-skeleton"></div>
      <div class="huntd-skeleton huntd-skeleton--sm"></div>
      <div class="huntd-skeleton"></div>
    </div>`;
  document.body.appendChild(el);
  bindClose();
  bindVaporGlow();
}

export function updateSidebar(response) {
  const context = window.__HUNTD_LENS_CONTEXT__ || {};
  const profileData = context.profileData || {};

  // ── No API key ────────────────────────────────────────────────────────────
  if (response.error === 'NO_API_KEY') {
    setSidebarContent(`
      ${header('Setup required')}
      <div class="huntd-state-card">
        <div class="huntd-state-title">API key missing</div>
        <div class="huntd-state-msg">Open the extension popup and enter your Huntd API key to activate lead intelligence.</div>
        <button class="huntd-btn huntd-btn--primary huntd-open-settings" type="button">Open Settings</button>
      </div>`);
    bindClose();
    bindVaporGlow();
    document.querySelector(`#${SIDEBAR_ID} .huntd-open-settings`)
      ?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }));
    return;
  }

  // ── Network error ─────────────────────────────────────────────────────────
  if (response.error === 'NETWORK_ERROR') {
    setSidebarContent(`
      ${header('Backend offline')}
      <div class="huntd-state-card">
        <div class="huntd-state-title">Can't reach backend</div>
        <div class="huntd-state-msg">Make sure the backend is running and the URL in settings is correct (e.g. http://localhost:3002).</div>
        <button class="huntd-btn huntd-btn--secondary huntd-retry" type="button">Retry</button>
      </div>`);
    bindClose();
    bindVaporGlow();
    document.querySelector(`#${SIDEBAR_ID} .huntd-retry`)
      ?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('huntd-lens-retry')));
    return;
  }

  // ── Generic error ─────────────────────────────────────────────────────────
  if (!response.success) {
    setSidebarContent(`
      ${header('Error')}
      <div class="huntd-state-card">
        <div class="huntd-state-title">Something went wrong</div>
        <div class="huntd-state-msg">${response.message || 'Unable to load lead intelligence right now.'}</div>
      </div>`);
    bindClose();
    bindVaporGlow();
    return;
  }

  // ── Success ───────────────────────────────────────────────────────────────
  const data      = response.data;
  const isOffline = Boolean(response.offline);
  const icp       = data.icpScore;
  const profile   = data.profile;

  // Determine match state label
  const matchLabel = data.competitorTools?.length > 0
    ? (isOffline ? 'Local score' : 'Partial match')
    : 'Company intelligence';

  // Competitor pills
  const toolsHtml = data.competitorTools?.length > 0
    ? `<div class="huntd-pills">${data.competitorTools.map(t =>
        `<span class="huntd-pill">${t.toolName}</span>`).join('')}</div>`
    : `<div class="huntd-pills"><span style="font-size:11px;color:var(--muted)">None detected</span></div>`;

  // Contacts
  const contacts = (data.competitorTools || []).flatMap(t => t.contacts || []).slice(0, 4);
  const contactsHtml = contacts.length
    ? `<div class="huntd-contacts">${contacts.map(c =>
        `<div class="huntd-contact-row">
          <span class="huntd-contact-dot"></span>
          <span>${c.firstName} ${c.lastName?.[0] ? c.lastName[0] + '.' : ''} — ${c.jobTitle || ''}</span>
        </div>`).join('')}</div>`
    : '';

  // Company size — extract just the number/range, strip "employees" suffix and noise
  const rawSize = profileData.companySize || '';
  const sizeDisplay = (() => {
    if (!rawSize || rawSize === 'Unknown') return '—';
    // Match patterns like "10K+ employees", "1,001-5,000 employees", "51-200 employees"
    const match = rawSize.match(/(\d[\d,K]*\+?(?:\s*[–\-]\s*\d[\d,K]*\+?)?)\s*employees?/i);
    if (match) return match[1].trim();
    // If no "employees" word, return cleaned raw value (strip trailing noise)
    return rawSize.replace(/\s*employees?\s*/i, '').trim().slice(0, 20) || '—';
  })();

  // Pitch angle
  const pitch = pitchAngle(
    { companyName: profile.companyName, companySize: profileData.companySize },
    data.competitorTools
  );

  // Clean display name (strip "(Company)" suffix)
  const displayName = profile.fullName.replace(/\s*\(Company\)\s*$/i, '').trim();

  setSidebarContent(`
    ${header('Lead Intel')}
    <div class="huntd-body">

      <!-- Summary -->
      <p class="huntd-summary">
        ${isOffline
          ? 'Backend offline — showing local ICP score from page data.'
          : 'Contact-level intelligence from Huntd.'}
      </p>

      <!-- Profile + Score card -->
      <div class="huntd-card">
        <div class="huntd-match-label">${matchLabel}</div>
        <div class="huntd-profile-row">
          <div class="huntd-profile-left">
            <div class="huntd-profile-name">${displayName}</div>
            <div class="huntd-profile-role">${profile.jobTitle} at ${profile.companyName}</div>
          </div>
          <div class="huntd-score-box">
            <span class="huntd-score-label-top">Score</span>
            <span class="huntd-score-number ${scoreClass(icp.label)}">${icp.score}</span>
          </div>
        </div>
      </div>

      <!-- Competitors + Company size grid -->
      <div class="huntd-grid2">
        <div class="huntd-mini-card">
          <div class="huntd-mini-label">Competitors</div>
          ${toolsHtml}
          ${contactsHtml}
        </div>
        <div class="huntd-mini-card">
          <div class="huntd-mini-label">Company size</div>
          <div class="huntd-mini-value huntd-mini-value--large">${sizeDisplay}</div>
        </div>
      </div>

      <!-- ICP breakdown bars -->
      <div class="huntd-card">
        <div class="huntd-match-label">ICP breakdown</div>
        <div class="huntd-bars">
          <div class="huntd-bar-row">
            <span class="huntd-bar-label">Activity</span>
            <div class="huntd-bar-track"><div class="huntd-bar-fill" style="width:${barPct(icp.breakdown.activity,20)}"></div></div>
          </div>
          <div class="huntd-bar-row">
            <span class="huntd-bar-label">Title</span>
            <div class="huntd-bar-track"><div class="huntd-bar-fill" style="width:${barPct(icp.breakdown.jobTitle,30)}"></div></div>
          </div>
          <div class="huntd-bar-row">
            <span class="huntd-bar-label">Tenure</span>
            <div class="huntd-bar-track"><div class="huntd-bar-fill" style="width:${barPct(icp.breakdown.tenure,20)}"></div></div>
          </div>
        </div>
      </div>

      <!-- Pitch angle -->
      <div class="huntd-card">
        <div class="huntd-pitch-label">Pitch angle</div>
        <div class="huntd-pitch-text">${pitch}</div>
      </div>

      <!-- Actions -->
      <div class="huntd-actions">
        <button class="huntd-btn huntd-btn--secondary huntd-copy-template" type="button">Copy template</button>
        <button class="huntd-btn huntd-btn--primary huntd-view-huntd" type="button">View in Huntd →</button>
      </div>

      <!-- Keyword search -->
      <div class="huntd-card">
        <div class="huntd-pitch-label">Keyword Search</div>
        <div class="huntd-search-row">
          <input
            class="huntd-search-input"
            type="text"
            placeholder='e.g. "sales", "AI", "scaling"'
            id="huntd-kw-input"
          />
          <button class="huntd-btn huntd-btn--secondary huntd-search-btn" type="button" id="huntd-kw-btn">Search</button>
        </div>
        <div id="huntd-search-results"></div>
      </div>

      <!-- AI Analysis -->
      <div class="huntd-card">
        <div class="huntd-pitch-label">AI Score</div>
        <p class="huntd-pitch-text" style="margin-bottom:10px">
          Gemini scores this lead using title, company size, tenure and activity — alongside the rule-based score.
        </p>
        <button class="huntd-btn huntd-btn--primary huntd-ai-btn" type="button" id="huntd-ai-btn" style="width:100%">
          ✦ Run AI Analysis
        </button>
        <div id="huntd-ai-results"></div>
      </div>

    </div>

    <!-- Footer -->
    <div class="huntd-footer">
      <span class="huntd-footer-ts">${isOffline ? '⚠ Local score' : `Updated ${formatDate(data.fetchedAt)}`}</span>
      <a class="huntd-powered" href="https://gethuntd.com" target="_blank" rel="noreferrer">Powered by Huntd</a>
    </div>`);

  bindClose();
  bindVaporGlow();

  // Copy template
  document.querySelector(`#${SIDEBAR_ID} .huntd-copy-template`)
    ?.addEventListener('click', async (e) => {
      const sizeNum = Number(String(profileData.companySize || '').match(/\d+/)?.[0]) || 0;
      const tpl = generateTemplate(
        { fullName: displayName, companyName: profile.companyName, jobTitle: profile.jobTitle, companySize: sizeNum },
        data.competitorTools || []
      );
      await navigator.clipboard.writeText(tpl);
      const btn = e.currentTarget;
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });

  // View in Huntd
  document.querySelector(`#${SIDEBAR_ID} .huntd-view-huntd`)
    ?.addEventListener('click', () =>
      window.open(data.huntdDashboardUrl, '_blank', 'noopener,noreferrer'));

  // ── Keyword search ──────────────────────────────────────────────────────
  const kwInput = document.getElementById('huntd-kw-input');
  const kwBtn   = document.getElementById('huntd-kw-btn');
  const kwResults = document.getElementById('huntd-search-results');

  const runSearch = () => {
    const keyword = kwInput?.value?.trim();
    if (!keyword) return;
    const ctx = window.__HUNTD_LENS_CONTEXT__;
    if (!ctx?.searchKeyword || !ctx?.pageText) {
      kwResults.innerHTML = `<p class="huntd-search-empty">Page text not available yet.</p>`;
      return;
    }
    const { results, totalMatches } = ctx.searchKeyword(keyword, ctx.pageText);
    if (totalMatches === 0) {
      kwResults.innerHTML = `<p class="huntd-search-empty">No matches for "<strong>${keyword}</strong>" on this page.</p>`;
      return;
    }
    const sectionLabels = { about: 'About', experience: 'Experience', education: 'Education', skills: 'Skills', posts: 'Posts', other: 'Other' };
    let html = `<p class="huntd-search-count">${totalMatches} match${totalMatches !== 1 ? 'es' : ''} for "<strong>${keyword}</strong>"</p>`;
    for (const [section, snippets] of Object.entries(results)) {
      html += `<div class="huntd-search-section">
        <div class="huntd-search-section-label">${sectionLabels[section] || section}</div>
        ${snippets.map(s => `<div class="huntd-search-snippet">${s}</div>`).join('')}
      </div>`;
    }
    kwResults.innerHTML = html;
  };

  kwBtn?.addEventListener('click', runSearch);
  kwInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

  // ── AI Analysis ─────────────────────────────────────────────────────────
  const aiBtn     = document.getElementById('huntd-ai-btn');
  const aiResults = document.getElementById('huntd-ai-results');

  // One call per sidebar render — cached after first success, blocked while in-flight
  let aiInFlight = false;
  let aiCachedResult = null;

  aiBtn?.addEventListener('click', async () => {
    // Block duplicate calls while a request is already running
    if (aiInFlight) return;

    // Show cached result immediately if already fetched
    if (aiCachedResult) {
      renderAiResult(aiCachedResult);
      return;
    }

    aiInFlight = true;
    aiBtn.disabled = true;
    aiBtn.textContent = '✦ Analysing...';
    aiResults.innerHTML = `
      <div class="huntd-ai-loading">
        <div class="huntd-skeleton" style="margin-top:10px"></div>
        <div class="huntd-skeleton huntd-skeleton--sm"></div>
        <div class="huntd-skeleton"></div>
      </div>`;

    const ctx = window.__HUNTD_LENS_CONTEXT__;
    if (!ctx?.requestAiAnalysis) {
      aiResults.innerHTML = `<p class="huntd-search-empty">Context not ready. Refresh the page.</p>`;
      aiBtn.disabled = false;
      aiBtn.textContent = '✦ Run AI Analysis';
      aiInFlight = false;
      return;
    }

    const response = await ctx.requestAiAnalysis(icp);

    aiInFlight = false;
    aiBtn.disabled = false;
    aiBtn.textContent = '✦ Run AI Analysis';

    if (response?.error) {
      aiResults.innerHTML = `<p class="huntd-search-empty">Error: ${response.message || response.error}</p>`;
      return;
    }

    const a = response.analysis;
    if (!a || typeof a.aiScore === 'undefined') {
      aiResults.innerHTML = `<p class="huntd-search-empty">Unexpected response. Try again.</p>`;
      return;
    }

    // Cache so re-pressing doesn't call the API again
    aiCachedResult = a;
    renderAiResult(a);
  });

  function renderAiResult(a) {
    const score = Number(a.aiScore) || 0;
    const label = score >= 75 ? 'Hot' : score >= 50 ? 'Warm' : 'Cold';
    const cls   = score >= 75 ? 'huntd-score-number--hot' : score >= 50 ? 'huntd-score-number--warm' : 'huntd-score-number--cold';
    aiResults.innerHTML = `
      <div class="huntd-ai-score-row" style="margin-top:12px">
        <div style="text-align:center;flex-shrink:0">
          <div class="huntd-ai-section-label">AI Score</div>
          <span class="huntd-score-number ${cls}" style="font-size:32px;display:block;line-height:1">${score}</span>
          <span class="huntd-ai-badge">${label}</span>
        </div>
        <div style="flex:1;min-width:0">
          <div class="huntd-ai-section-label">Reasoning</div>
          <p class="huntd-pitch-text">${a.reasoning || '—'}</p>
        </div>
      </div>`;
  }
}

export function destroySidebar() { getSidebar()?.remove(); }
