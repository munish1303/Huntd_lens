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

  const localSidebarHelpers = (() => {
    const SIDEBAR_ID = 'huntd-lens-sidebar';

    const getSidebar = () => document.getElementById(SIDEBAR_ID);
    const destroySidebar = () => getSidebar()?.remove();
    const bindClose = () => {
      document.querySelector(`#${SIDEBAR_ID} .huntd-close`)?.addEventListener('click', () => destroySidebar());
    };
    const initSidebar = () => {
      destroySidebar();
      const sidebar = document.createElement('div');
      sidebar.id = SIDEBAR_ID;
      sidebar.innerHTML = `
        <div class="huntd-header">
          <div class="huntd-brand">Huntd Lens</div>
          <button class="huntd-close" type="button" aria-label="Close sidebar">×</button>
        </div>
        <div class="huntd-loading">
          <div class="huntd-skeleton huntd-skeleton--lg"></div>
          <div class="huntd-skeleton"></div>
          <div class="huntd-skeleton"></div>
          <div class="huntd-skeleton huntd-skeleton--sm"></div>
        </div>
      `;
      document.body.appendChild(sidebar);
      bindClose();
    };
    const updateSidebar = (response) => {
      const sidebar = getSidebar();
      if (!sidebar) return;
      const message =
        response.error === 'NO_API_KEY'
          ? 'Set your API key in the extension settings.'
          : response.error === 'NETWORK_ERROR'
            ? 'Could not reach Huntd backend. Check your connection or backend URL in settings.'
            : response.error
              ? response.message || 'Could not load Huntd Lens on this page.'
              : 'Huntd Lens loaded.';
      sidebar.innerHTML = `
        <div class="huntd-header">
          <div class="huntd-brand">Huntd Lens</div>
          <button class="huntd-close" type="button" aria-label="Close sidebar">×</button>
        </div>
        <div class="huntd-section">
          <p class="huntd-message">${message}</p>
        </div>
      `;
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
  } catch (_error) {}

  try {
    const scorerModule = await import(chrome.runtime.getURL('utils/scorer.js'));
    scoreICP = scorerModule.scoreICP || scoreICP;
  } catch (_error) {}

  let currentUrl = window.location.href;
  let activeRetryHandler = null;
  let loadSequence = 0;

  window.addEventListener('huntd-lens-retry', () => {
    if (typeof activeRetryHandler === 'function') {
      activeRetryHandler();
    }
  });

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
      (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth())
    );
  }

  function parseDateFromText(text) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
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

  // Like firstText but returns the first element's text that passes a filter fn
  function firstMatchingText(selector, filterFn) {
    try {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        const text = el?.textContent?.trim();
        if (text && filterFn(text)) return text;
      }
    } catch (_e) {}
    return null;
  }

  function firstAttr(selector, attr) {
    try {
      const el = document.querySelector(selector);
      const val = el?.getAttribute(attr)?.trim();
      return val || null;
    } catch (_e) {
      return null;
    }
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

  // Extract only the person's name from an h1 — strips degree badges like "· 2nd"
  function extractPersonName() {
    try {
      // Strategy 1: LinkedIn's current DOM — name is in the first h1 on the page.
      // The h1 may have child spans; we want the first meaningful text node or span.
      const h1 = document.querySelector('h1');
      if (h1) {
        // Walk direct children looking for a text node or span with the name
        for (const child of h1.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const t = child.textContent?.trim();
            if (t && t.length > 1) return t;
          }
          if (child.nodeType === Node.ELEMENT_NODE) {
            const t = child.textContent?.trim();
            // Skip degree badges like "· 2nd", "· 1st", connection count spans
            if (t && t.length > 1 && !/^[·•]\s*(1st|2nd|3rd|\d)/.test(t) && !/^\d+$/.test(t)) {
              return t;
            }
          }
        }
        // Fallback: full h1 text minus the degree badge
        const raw = h1.textContent?.trim() || '';
        const cleaned = raw.replace(/\s*[·•]\s*(1st|2nd|3rd|\d+\w*)\s*$/i, '').trim();
        if (cleaned.length > 1) return cleaned;
      }

      // Strategy 2: LinkedIn sometimes uses these class names
      const byClass =
        document.querySelector('.pv-text-details__left-panel h1')?.textContent?.trim() ||
        document.querySelector('.top-card-layout__title')?.textContent?.trim() ||
        document.querySelector('[class*="profile-header"] h1')?.textContent?.trim();
      if (byClass) return byClass.replace(/\s*[·•]\s*(1st|2nd|3rd|\d+\w*)\s*$/i, '').trim();

    } catch (_e) {}
    return null;
  }

  // Extract current company from the profile page
  function extractCurrentCompany(jobTitle) {
    try {
      // 1. LinkedIn shows current company as a linked button in the top card
      //    e.g. <a href="/company/deel">Deel</a> or a span with aria-label
      const companyLink =
        document.querySelector('.pv-text-details__right-panel-item-link') ||
        document.querySelector('[data-field="experience_company_logo"] a') ||
        document.querySelector('.top-card-layout__card a[href*="/company/"]') ||
        document.querySelector('a[href*="linkedin.com/company/"]');
      if (companyLink) {
        const t = companyLink.textContent?.trim();
        if (t && t.length > 0 && t.length < 80) return t;
      }

      // 2. Try experience section — first list item company name
      const expCompany =
        firstMatchingText(
          '#experience ~ div li .t-14.t-normal, #experience ~ div li .t-black--light',
          (t) => t.length > 0 && t.length < 80 && !/\d{4}/.test(t)
        ) ||
        firstMatchingText(
          'section[id*="experience"] li span[aria-hidden="true"]',
          (t) => t.length > 0 && t.length < 80
        );
      if (expCompany) return expCompany;

      // 3. Parse "@ CompanyName" from the headline/job title
      const atMatch = jobTitle?.match(/[@＠]\s*([^|·\n]+)/);
      if (atMatch) return atMatch[1].trim();

      // 4. Parse "at CompanyName" from the headline
      const atWordMatch = jobTitle?.match(/\bat\s+([A-Z][^|·\n]{1,60})/);
      if (atWordMatch) return atWordMatch[1].trim();

    } catch (_e) {}
    return null;
  }

  function extractProfileData() {
    const companyPage = isCompanyPage();

    // ── Company name (company pages) ──────────────────────────────────────────
    let companyName = 'Unknown Company';
    try {
      if (companyPage) {
        companyName =
          firstText(
            'h1.org-top-card-summary__title',
            '.org-top-card-summary__title',
            'h1[class*="org-top-card"]',
            'h1'
          ) || 'Unknown Company';
      }
    } catch (_e) {}

    // ── Full name (person pages) ───────────────────────────────────────────────
    let fullName = companyPage ? `${companyName} (Company)` : 'Unknown Profile';
    try {
      if (!companyPage) {
        fullName = extractPersonName() || 'Unknown Profile';
      }
    } catch (_e) {}

    // ── Job title / tagline ───────────────────────────────────────────────────
    let jobTitle = companyPage ? 'Company Page' : 'Unknown Title';
    try {
      if (companyPage) {
        jobTitle =
          firstText(
            '.org-top-card-summary__tagline',
            '.org-top-card-summary__industry',
            '[class*="tagline"]'
          ) ||
          scanAllText(/\b(IT|software|consulting|services|technology|financial|healthcare|manufacturing)\b/i, 120) ||
          'Company Page';
      } else {
        // LinkedIn's current headline selector — the div directly below the name
        jobTitle =
          firstText(
            '.text-body-medium.break-words',
            '.pv-text-details__left-panel .text-body-medium',
            '.top-card-layout__headline',
            '[class*="headline"]'
          ) ||
          // Fallback: find a text node that looks like a job title (contains @ or role keywords)
          firstMatchingText(
            'div, span',
            (t) =>
              t.length > 5 &&
              t.length < 220 &&
              (/@/.test(t) || /\b(engineer|manager|director|vp|ceo|cto|coo|founder|lead|analyst|consultant|president|officer|head of|partner)\b/i.test(t))
          ) ||
          'Unknown Title';
      }
    } catch (_e) {}

    // ── Current company (person pages) ────────────────────────────────────────
    if (!companyPage) {
      try {
        companyName = extractCurrentCompany(jobTitle) || 'Unknown Company';
      } catch (_e) {}
    }

    // ── Company size ──────────────────────────────────────────────────────────
    let companySize = 'Unknown';
    try {
      companySize =
        firstText(
          '.org-top-card-summary-info-list__info-item',
          '[class*="company-size"]',
          '.org-about-company-module__company-size-definition-text'
        ) ||
        scanAllText(/\d[\d,]*\s*[–\-]\s*\d[\d,]*\s*employees|\d[\d,]*\+?\s*employees/i, 60) ||
        'Unknown';
    } catch (_e) {}

    // ── Tenure ────────────────────────────────────────────────────────────────
    let tenureMonths = 12;
    try {
      if (!companyPage) {
        const experienceText =
          firstText('#experience ~ * li', '.experience-item') ||
          scanAllText(/present/i, 300) ||
          '';
        const rangeMatch = experienceText.match(
          /([A-Za-z]{3,9}\s+\d{4})\s*[–\-]\s*(Present|[A-Za-z]{3,9}\s+\d{4})/i
        );
        if (rangeMatch) {
          const startDate = parseDateFromText(rangeMatch[1]);
          const endDate = /present/i.test(rangeMatch[2]) ? new Date() : parseDateFromText(rangeMatch[2]);
          if (startDate && endDate) tenureMonths = monthsBetween(startDate, endDate);
        }
      }
    } catch (_e) {}

    // ── LinkedIn activity ─────────────────────────────────────────────────────
    let linkedinActivityDays = 30;
    try {
      const activityText =
        firstText('.feed-shared-actor__sub-description') ||
        scanAllText(/\b\d+\s*(d|day|w|week|mo|month)\b/i, 60) ||
        '';
      const activityMatch = activityText.match(/(\d+)\s*(d|day|w|week|mo|month)/i);
      if (activityMatch) {
        const value = Number(activityMatch[1]);
        const unit = activityMatch[2].toLowerCase();
        if (unit.startsWith('d')) linkedinActivityDays = value;
        else if (unit.startsWith('w')) linkedinActivityDays = value * 7;
        else if (unit.startsWith('mo')) linkedinActivityDays = value * 30;
      }
    } catch (_e) {}

    return {
      fullName,
      jobTitle,
      companyName,
      companyDomain: guessCompanyDomain(companyName),
      companySize,
      tenureMonths,
      linkedinActivityDays
    };
  }

  function parseCompanySizeMidpoint(sizeString) {
    const numbers = String(sizeString || '').match(/\d[\d,]*/g) || [];
    if (/\+/.test(sizeString) && numbers.length === 1) return Number(numbers[0].replace(/,/g, ''));
    if (numbers.length >= 2) {
      const low = Number(numbers[0].replace(/,/g, ''));
      const high = Number(numbers[1].replace(/,/g, ''));
      return Math.round((low + high) / 2);
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
      payload: {
        linkedinUrl: window.location.href,
        profileData
      }
    });
  }

  async function runFetch(profileData, sequence) {
    if (sequence !== loadSequence) return;

    const response = await fetchProfileData(profileData);
    if (response?.success) {
      updateSidebar(response);
      return;
    }

    // Backend unreachable or errored — render with local ICP scoring as fallback
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

    // If it was a network error, show the retry UI but also render fallback data
    if (response?.error === 'NETWORK_ERROR' || response?.error === 'NO_API_KEY') {
      updateSidebar(response);
      return;
    }

    // For any other backend error, render what we have locally
    updateSidebar({ success: true, data: fallbackData, offline: true });
  }

  async function loadProfile(maxRetries = 5) {
    const sequence = ++loadSequence;

    initSidebar();

    // Wait for LinkedIn's SPA to finish rendering before first attempt
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (sequence !== loadSequence) return;

    let profileData = null;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      profileData = extractProfileData();
      // Consider data valid if we got a real name or company (not the fallback strings)
      const hasName = profileData.fullName !== 'Unknown Profile' && profileData.fullName !== 'Unknown Company (Company)';
      const hasCompany = profileData.companyName !== 'Unknown Company';
      if (hasName || hasCompany) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (sequence !== loadSequence) return;

    const settings = await loadSettings();
    if (!settings.enabled) {
      destroySidebar();
      return;
    }

    window.__HUNTD_LENS_CONTEXT__ = {
      profileData,
      linkedinUrl: window.location.href
    };

    activeRetryHandler = async () => {
      initSidebar();
      await runFetch(profileData, sequence);
    };

    await runFetch(profileData, sequence);
  }

  const observer = new MutationObserver(() => {
    if (
      window.location.href !== currentUrl &&
      /^https:\/\/www\.linkedin\.com\/(in|company)\//.test(window.location.href)
    ) {
      currentUrl = window.location.href;
      destroySidebar();
      setTimeout(() => {
        loadProfile();
      }, 1500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  loadProfile();
})();
