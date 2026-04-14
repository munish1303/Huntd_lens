(async () => {
  const fallbackScoreICP = (profileData) => {
    const getTitleScore = (jobTitle = '') => {
      if (/(ceo|cro|vp|chief)/i.test(jobTitle)) return 30;
      if (/(director|head)/i.test(jobTitle)) return 22;
      if (/(manager|lead)/i.test(jobTitle)) return 15;
      return 8;
    };
    const getCompanySizeScore = (companySize = 0) => {
      if (companySize >= 11 && companySize <= 200) return 20;
      if (companySize >= 201 && companySize <= 500) return 18;
      if (companySize >= 501 && companySize <= 1000) return 14;
      if (companySize >= 1 && companySize <= 10) return 10;
      if (companySize > 1000) return 8;
      return 8;
    };
    const getTenureScore = (tenureMonths = 0) => {
      if (tenureMonths >= 12 && tenureMonths <= 36) return 20;
      if (tenureMonths >= 6 && tenureMonths < 12) return 15;
      if (tenureMonths > 36 && tenureMonths <= 60) return 12;
      if (tenureMonths > 60) return 8;
      return 5;
    };
    const getActivityScore = (linkedinActivityDays = 999) => {
      if (linkedinActivityDays <= 7) return 20;
      if (linkedinActivityDays <= 14) return 16;
      if (linkedinActivityDays <= 30) return 10;
      if (linkedinActivityDays <= 60) return 5;
      return 0;
    };
    const breakdown = {
      jobTitle: getTitleScore(profileData.jobTitle),
      companySize: getCompanySizeScore(profileData.companySize),
      tenure: getTenureScore(profileData.tenureMonths),
      activity: getActivityScore(profileData.linkedinActivityDays),
      tools: Math.min((profileData.competitorTools?.length || 0) * 2, 10)
    };
    const score = breakdown.jobTitle + breakdown.companySize + breakdown.tenure + breakdown.activity + breakdown.tools;
    const label = score >= 75 ? 'Hot' : score >= 50 ? 'Warm' : 'Cold';
    return { score, breakdown, label };
  };

  // ── Inline fallback sidebar (used if sidebar.js module fails to load) ─────
  const localSidebarHelpers = (() => {
    const SIDEBAR_ID = 'huntd-lens-sidebar';
    const getSidebar = () => document.getElementById(SIDEBAR_ID);
    const destroySidebar = () => getSidebar()?.remove();
    const bindClose = () => {
      document.querySelector(`#${SIDEBAR_ID} .huntd-close`)
        ?.addEventListener('click', () => destroySidebar());
    };
    const initSidebar = () => {
      destroySidebar();
      const sidebar = document.createElement('div');
      sidebar.id = SIDEBAR_ID;
      sidebar.innerHTML = `
        <div class="huntd-header">
          <div class="huntd-brand-wrap">
            <span class="huntd-eyebrow">Huntd Lens</span>
            <span class="huntd-brand">Loading...</span>
          </div>
          <button class="huntd-close" type="button" aria-label="Close">x</button>
        </div>
        <div class="huntd-loading">
          <div class="huntd-skeleton huntd-skeleton--xl"></div>
          <div class="huntd-skeleton huntd-skeleton--lg"></div>
          <div class="huntd-skeleton"></div>
          <div class="huntd-skeleton huntd-skeleton--sm"></div>
        </div>`;
      document.body.appendChild(sidebar);
      bindClose();
    };
    const updateSidebar = (response) => {
      const sidebar = getSidebar();
      if (!sidebar) return;
      const msg = response.error === 'NO_API_KEY'
        ? 'Set your API key in the extension settings.'
        : response.error === 'NETWORK_ERROR'
          ? 'Could not reach Huntd backend.'
          : response.message || 'Could not load Huntd Lens.';
      sidebar.innerHTML = `
        <div class="huntd-header">
          <div class="huntd-brand-wrap">
            <span class="huntd-eyebrow">Huntd Lens</span>
            <span class="huntd-brand">Lead Intel</span>
          </div>
          <button class="huntd-close" type="button" aria-label="Close">x</button>
        </div>
        <div class="huntd-state-card"><p class="huntd-state-msg">${msg}</p></div>`;
      bindClose();
    };
    return { initSidebar, updateSidebar, destroySidebar };
  })();

  let initSidebar = localSidebarHelpers.initSidebar;
  let updateSidebar = localSidebarHelpers.updateSidebar;
  let destroySidebar = localSidebarHelpers.destroySidebar;
  let scoreICP = fallbackScoreICP;

  try {
    const sidebarModule = await import(chrome.runtime.getURL('content/sidebar.js'));
    initSidebar = sidebarModule.initSidebar || initSidebar;
    updateSidebar = sidebarModule.updateSidebar || updateSidebar;
    destroySidebar = sidebarModule.destroySidebar || destroySidebar;
  } catch (_e) {}

  try {
    const scorerModule = await import(chrome.runtime.getURL('utils/scorer.js'));
    scoreICP = scorerModule.scoreICP || scoreICP;
  } catch (_e) {}

  let currentUrl = window.location.href;
  let activeRetryHandler = null;
  let loadSequence = 0;

  window.addEventListener('huntd-lens-retry', () => {
    if (typeof activeRetryHandler === 'function') activeRetryHandler();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function guessCompanyDomain(companyName) {
    if (!companyName) return 'unknown.com';
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
    return slug ? `${slug}.com` : 'unknown.com';
  }

  function isCompanyPage() {
    return /^https:\/\/www\.linkedin\.com\/company\//.test(window.location.href);
  }

  function monthsBetween(startDate, endDate) {
    return Math.max(
      1,
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth())
    );
  }

  function parseDateFromText(text) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function firstText(...selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        const text = el?.textContent?.trim();
        if (text) return text;
      } catch (_e) {}
    }
    return null;
  }

  function firstMatchingText(selector, filterFn) {
    try {
      for (const el of document.querySelectorAll(selector)) {
        const text = el?.textContent?.trim();
        if (text && filterFn(text)) return text;
      }
    } catch (_e) {}
    return null;
  }

  function scanAllText(pattern, maxLen = 200) {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text && text.length < maxLen && pattern.test(text)) return text;
      }
    } catch (_e) {}
    return null;
  }

  function cleanName(raw) {
    return (raw || '')
      .replace(/\s*[·•]\s*(1st|2nd|3rd|\d+\w*)\s*/gi, '')
      .replace(/\s*[\u2713\u2714\u2705\u2611\ufe0f]+\s*/g, '')
      .replace(/\s*\([^)]{2,20}\/[^)]{2,20}\)\s*/g, '')
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getProfileName() {
    try {
      const primary = document.querySelector('h1.text-heading-xlarge');
      if (primary) {
        const name = cleanName(primary.innerText || primary.textContent);
        if (name.length > 1) return name;
      }
      const leftPanel = document.querySelector('div.pv-text-details__left-panel h1, .top-card-layout__title');
      if (leftPanel) {
        const name = cleanName(leftPanel.innerText || leftPanel.textContent);
        if (name.length > 1) return name;
      }
      const h1 = document.querySelector('h1');
      if (h1) {
        let best = '';
        for (const child of h1.childNodes) {
          const raw = child.nodeType === Node.TEXT_NODE
            ? child.textContent
            : child.nodeType === Node.ELEMENT_NODE
              ? (child.innerText || child.textContent)
              : '';
          const candidate = cleanName(raw);
          if (candidate.length > best.length && candidate.length > 1 &&
              /[a-zA-Z\u00C0-\u024F]/.test(candidate) && !/^[\d·•]+$/.test(candidate)) {
            best = candidate;
          }
        }
        if (best.length > 1) return best;
        const full = cleanName(h1.innerText || h1.textContent);
        if (full.length > 1) return full;
      }
      const titleName = cleanName((document.title || '').split(/\s*[|\-–]\s*/)[0]);
      if (titleName.length > 1 && !/linkedin/i.test(titleName)) return titleName;
    } catch (_e) {}
    return 'Name Not Detected';
  }

  function extractCurrentCompany(jobTitle) {
    try {
      const companyLink =
        document.querySelector('.pv-text-details__right-panel-item-link') ||
        document.querySelector('[data-field="experience_company_logo"] a') ||
        document.querySelector('.top-card-layout__card a[href*="/company/"]') ||
        document.querySelector('a[href*="linkedin.com/company/"]');
      if (companyLink) {
        const t = companyLink.textContent?.trim();
        if (t && t.length > 0 && t.length < 80) return t;
      }
      const expCompany =
        firstMatchingText('#experience ~ div li .t-14.t-normal, #experience ~ div li .t-black--light',
          (t) => t.length > 0 && t.length < 80 && !/\d{4}/.test(t)) ||
        firstMatchingText('section[id*="experience"] li span[aria-hidden="true"]',
          (t) => t.length > 0 && t.length < 80);
      if (expCompany) return expCompany;
      const atMatch = jobTitle?.match(/[@\uFF20]\s*([^|·\n]+)/);
      if (atMatch) return atMatch[1].trim();
      const atWordMatch = jobTitle?.match(/\bat\s+([A-Z][^|·\n]{1,60})/);
      if (atWordMatch) return atWordMatch[1].trim();
    } catch (_e) {}
    return null;
  }

  function extractProfileData() {
    const companyPage = isCompanyPage();
    let companyName = 'Unknown Company';
    try {
      if (companyPage) {
        companyName = firstText('h1.org-top-card-summary__title', '.org-top-card-summary__title',
          'h1[class*="org-top-card"]', 'h1') || 'Unknown Company';
      }
    } catch (_e) {}

    let fullName = companyPage ? `${companyName} (Company)` : 'Unknown Profile';
    try {
      if (!companyPage) fullName = getProfileName();
    } catch (_e) {}

    let jobTitle = companyPage ? 'Company Page' : 'Unknown Title';
    try {
      if (companyPage) {
        jobTitle = firstText('.org-top-card-summary__tagline', '.org-top-card-summary__industry',
          '[class*="tagline"]') ||
          scanAllText(/\b(IT|software|consulting|services|technology|financial|healthcare|manufacturing)\b/i, 120) ||
          'Company Page';
      } else {
        jobTitle = firstText('.text-body-medium.break-words',
          '.pv-text-details__left-panel .text-body-medium',
          '.top-card-layout__headline', '[class*="headline"]') ||
          firstMatchingText('div, span', (t) =>
            t.length > 5 && t.length < 220 &&
            (/@/.test(t) || /\b(engineer|manager|director|vp|ceo|cto|coo|founder|lead|analyst|consultant|president|officer|head of|partner)\b/i.test(t))
          ) || 'Unknown Title';
      }
    } catch (_e) {}

    if (!companyPage) {
      try { companyName = extractCurrentCompany(jobTitle) || 'Unknown Company'; } catch (_e) {}
    }

    let companySize = 'Unknown';
    try {
      // Specifically find the item containing "employees" — not industry or location
      companySize =
        firstMatchingText(
          '.org-top-card-summary-info-list__info-item, [class*="company-size"], dt ~ dd',
          (t) => /employee/i.test(t) && t.length < 60
        ) ||
        // Scan all text nodes for the employees pattern
        scanAllText(/\d[\d,]*\s*[–\-]\s*\d[\d,]*\s*employees|\d[\d,]*\+?\s*employees/i, 60) ||
        // Fallback: any text matching K+ employees pattern (e.g. "10K+ employees")
        scanAllText(/\d+K\+?\s*employees/i, 40) ||
        'Unknown';
    } catch (_e) {}

    let tenureMonths = 12;
    try {
      if (!companyPage) {
        const expText = firstText('#experience ~ * li', '.experience-item') ||
          scanAllText(/present/i, 300) || '';
        const rangeMatch = expText.match(/([A-Za-z]{3,9}\s+\d{4})\s*[–\-]\s*(Present|[A-Za-z]{3,9}\s+\d{4})/i);
        if (rangeMatch) {
          const startDate = parseDateFromText(rangeMatch[1]);
          const endDate = /present/i.test(rangeMatch[2]) ? new Date() : parseDateFromText(rangeMatch[2]);
          if (startDate && endDate) tenureMonths = monthsBetween(startDate, endDate);
        }
      }
    } catch (_e) {}

    let linkedinActivityDays = 30;
    try {
      const actText = firstText('.feed-shared-actor__sub-description') ||
        scanAllText(/\b\d+\s*(d|day|w|week|mo|month)\b/i, 60) || '';
      const actMatch = actText.match(/(\d+)\s*(d|day|w|week|mo|month)/i);
      if (actMatch) {
        const value = Number(actMatch[1]);
        const unit = actMatch[2].toLowerCase();
        if (unit.startsWith('d')) linkedinActivityDays = value;
        else if (unit.startsWith('w')) linkedinActivityDays = value * 7;
        else if (unit.startsWith('mo')) linkedinActivityDays = value * 30;
      }
    } catch (_e) {}

    return { fullName, jobTitle, companyName, companyDomain: guessCompanyDomain(companyName), companySize, tenureMonths, linkedinActivityDays };
  }

  function parseCompanySizeMidpoint(sizeString) {
    const numbers = String(sizeString || '').match(/\d[\d,]*/g) || [];
    if (/\+/.test(sizeString) && numbers.length === 1) return Number(numbers[0].replace(/,/g, ''));
    if (numbers.length >= 2) {
      return Math.round((Number(numbers[0].replace(/,/g, '')) + Number(numbers[1].replace(/,/g, ''))) / 2);
    }
    if (numbers.length === 1) return Number(numbers[0].replace(/,/g, ''));
    return 0;
  }

  async function loadSettings() {
    return chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  }

  async function fetchProfileData(profileData) {
    return chrome.runtime.sendMessage({
      type: 'FETCH_PROFILE_DATA',
      payload: { linkedinUrl: window.location.href, profileData }
    });
  }

  // ── Deep scrape — expands lazy sections then reads structured data ─────────
  async function deepScrape() {
    // Click "show more" buttons to expand collapsed sections
    const expand = (sel) => {
      try {
        document.querySelector(sel)?.querySelectorAll(
          'button[aria-expanded="false"], button.inline-show-more-text__button, button.show-more-less-html__button'
        ).forEach(btn => { try { btn.click(); } catch (_e) {} });
      } catch (_e) {}
    };
    expand('#about ~ *');
    expand('#experience ~ *');
    expand('#education ~ *');
    expand('#skills ~ *');
    await new Promise(r => setTimeout(r, 500));

    const result = { identity: { location: '' }, about: '', experience: [], education: [], skills: [], recentPosts: [] };
    try {
      result.identity.location =
        document.querySelector('.pv-text-details__left-panel .text-body-small:not(.break-words)')
          ?.innerText?.trim() || '';
      result.about = document.querySelector(
        '#about ~ * .inline-show-more-text, #about ~ * span[aria-hidden="true"], #about ~ * .pv-shared-text-with-see-more'
      )?.innerText?.trim() || '';
      result.experience = Array.from(document.querySelectorAll('#experience ~ * li'))
        .map(el => el.innerText?.trim()).filter(t => t && t.length > 5).slice(0, 10);
      result.education = Array.from(document.querySelectorAll('#education ~ * li'))
        .map(el => el.innerText?.trim()).filter(t => t && t.length > 5).slice(0, 5);
      result.skills = Array.from(document.querySelectorAll('#skills ~ * li, [id*="skills"] ~ * li'))
        .map(el => el.innerText?.trim()).filter(Boolean).slice(0, 20);
      result.recentPosts = Array.from(document.querySelectorAll(
        '.feed-shared-update-v2__description, .feed-shared-text, .update-components-text, [data-urn*="activity"] .break-words'
      )).map(el => el.innerText?.trim()).filter(t => t && t.length > 20).slice(0, 10);
    } catch (_e) {}
    return result;
  }

  // ── Build flat text sections for keyword search ───────────────────────────
  function buildTextSections(dp) {
    return {
      about:      dp.about || '',
      experience: (dp.experience || []).join('\n'),
      education:  (dp.education  || []).join('\n'),
      skills:     (dp.skills     || []).join(', '),
      posts:      (dp.recentPosts || []).join('\n\n'),
      other: (() => {
        try {
          const walker = document.createTreeWalker(
            document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT
          );
          const chunks = [];
          let node;
          while ((node = walker.nextNode())) {
            const t = node.textContent?.trim();
            if (t && t.length > 20 && t.length < 400) chunks.push(t);
          }
          return [...new Set(chunks)].join('\n');
        } catch (_e) { return ''; }
      })()
    };
  }

  // ── Keyword search ────────────────────────────────────────────────────────
  function searchKeyword(keyword, sections) {
    if (!keyword?.trim()) return null;
    const kw = keyword.trim().toLowerCase();
    // Safe regex escape — no external substitution
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const results = {};
    let totalMatches = 0;
    for (const [section, text] of Object.entries(sections)) {
      if (!text) continue;
      const matches = [];
      for (const line of text.split('\n')) {
        if (line.toLowerCase().includes(kw)) {
          const highlighted = line.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
          matches.push(highlighted.slice(0, 200));
        }
      }
      if (matches.length > 0) {
        results[section] = matches.slice(0, 5);
        totalMatches += matches.length;
      }
    }
    return { results, totalMatches, keyword };
  }

  // ── Main fetch + fallback ─────────────────────────────────────────────────
  async function runFetch(profileData, sequence) {
    if (sequence !== loadSequence) return;

    const fetchWithTimeout = Promise.race([
      fetchProfileData(profileData),
      new Promise(resolve => setTimeout(() => resolve({ error: 'TIMEOUT' }), 10000))
    ]);

    const response = await fetchWithTimeout;

    if (response?.success) {
      updateSidebar(response);
      return;
    }

    const fallbackData = {
      profile: {
        fullName: profileData.fullName,
        jobTitle: profileData.jobTitle,
        companyName: profileData.companyName,
        linkedinUrl: window.location.href
      },
      competitorTools: [],
      icpScore: scoreICP({
        jobTitle: profileData.jobTitle,
        companySize: parseCompanySizeMidpoint(profileData.companySize),
        tenureMonths: profileData.tenureMonths,
        linkedinActivityDays: profileData.linkedinActivityDays,
        competitorTools: []
      }),
      huntdDashboardUrl: `https://app.gethuntd.com/dashboard?domain=${encodeURIComponent(profileData.companyDomain)}`,
      fetchedAt: new Date().toISOString()
    };

    if (response?.error === 'NO_API_KEY' || response?.error === 'NETWORK_ERROR') {
      updateSidebar(response);
      return;
    }

    updateSidebar({ success: true, data: fallbackData, offline: true });
  }

  async function loadProfile(maxRetries = 3) {
    const sequence = ++loadSequence;
    initSidebar();

    await new Promise(resolve => setTimeout(resolve, 800));
    if (sequence !== loadSequence) return;

    let profileData = extractProfileData();
    for (let attempt = 0; attempt < maxRetries &&
         profileData.fullName === 'Name Not Detected' &&
         profileData.companyName === 'Unknown Company'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (sequence !== loadSequence) return;
      profileData = extractProfileData();
    }

    const settings = await loadSettings();
    if (!settings.enabled) { destroySidebar(); return; }

    // Run deep scrape once — result is cached for the lifetime of this page
    const deepProfilePromise = deepScrape();

    window.__HUNTD_LENS_CONTEXT__ = {
      profileData,
      linkedinUrl: window.location.href,
      pageText: { about: '', experience: '', education: '', skills: '', posts: '', other: '' },
      searchKeyword,
      // Called exactly once per button press — reuses the already-running deepScrape promise
      requestAiAnalysis: async (icpScore) => {
        const deepProfile = await deepProfilePromise;   // resolves instantly if already done
        return chrome.runtime.sendMessage({
          type: 'AI_ANALYSE',
          payload: { profileData, deepProfile, icpScore }
        });
      }
    };

    // Populate keyword search index once deep scrape finishes (non-blocking)
    deepProfilePromise.then(dp => {
      if (window.__HUNTD_LENS_CONTEXT__) {
        window.__HUNTD_LENS_CONTEXT__.pageText = buildTextSections(dp);
      }
    });

    activeRetryHandler = async () => {
      initSidebar();
      await runFetch(profileData, sequence);
    };

    await runFetch(profileData, sequence);
  }

  const observer = new MutationObserver(() => {
    if (window.location.href !== currentUrl &&
        /^https:\/\/www\.linkedin\.com\/(in|company)\//.test(window.location.href)) {
      currentUrl = window.location.href;
      destroySidebar();
      setTimeout(() => loadProfile(), 800);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  loadProfile();
})();
