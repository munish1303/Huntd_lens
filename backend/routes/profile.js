import { Router } from 'express';
import authMiddleware from '../middleware/auth.js';
import rateLimitMiddleware from '../middleware/rateLimit.js';
import { getCache, setCache } from '../middleware/cache.js';
import { lookupCompetitorData } from '../services/huntdService.js';
import { scoreICP } from '../services/icpScorer.js';
import { logger } from '../utils/logger.js';
import { normalizeProfileData } from '../services/linkedinScraper.js';

const router = Router();

const COMPETITOR_SOURCES = ['gong', 'retool', 'clay', 'outreach', 'salesloft', 'hubspot', 'salesforce', 'apollo', 'zoominfo'];

const buildCacheKey = (companyDomain, fullName) => `profile:${companyDomain}:${fullName}`;

export function parsedCompanySize(sizeString = '') {
  const numbers = String(sizeString).match(/\d[\d,]*/g) || [];

  if (/\+/.test(sizeString) && numbers.length === 1) {
    return Number(numbers[0].replace(/,/g, ''));
  }

  if (numbers.length >= 2) {
    const low = Number(numbers[0].replace(/,/g, ''));
    const high = Number(numbers[1].replace(/,/g, ''));
    return Math.round((low + high) / 2);
  }

  if (numbers.length === 1) {
    return Number(numbers[0].replace(/,/g, ''));
  }

  return 0;
}

function validatePayload(body) {
  const details = [];

  if (
    !body.linkedinUrl ||
    !/^https:\/\/www\.linkedin\.com\/(in|company)\//.test(body.linkedinUrl)
  ) {
    details.push('linkedinUrl must start with https://www.linkedin.com/in/ or https://www.linkedin.com/company/');
  }

  if (!body.profileData || typeof body.profileData !== 'object') {
    details.push('profileData is required');
  }

  return details;
}

function flattenCompetitorContacts(huntdResult) {
  return Object.entries(huntdResult || {}).flatMap(([toolName, contacts]) =>
    (Array.isArray(contacts) ? contacts : []).map((contact) => ({ ...contact, toolName }))
  );
}

function matchesProfile(contact, linkedinUrl, profileData) {
  if (contact.linkedinUrl && contact.linkedinUrl.toLowerCase() === linkedinUrl.toLowerCase()) {
    return true;
  }

  const fullName = String(profileData.fullName || '').trim().toLowerCase();
  const email = String(contact.email || '').toLowerCase();

  if (fullName && email) {
    const normalizedName = fullName.replace(/[^a-z0-9]+/g, '.');
    return email.includes(normalizedName) || email.includes(fullName.replace(/\s+/g, ''));
  }

  return false;
}

router.post('/', authMiddleware, rateLimitMiddleware, async (req, res) => {
  try {
    const errors = validatePayload(req.body || {});
    if (errors.length > 0) {
      res.status(400).json({ error: 'Invalid request', details: errors });
      return;
    }

    const linkedinUrl = req.body.linkedinUrl;
    const profileData = normalizeProfileData(req.body.profileData);
    const cacheKey = buildCacheKey(profileData.companyDomain, profileData.fullName);
    const cached = getCache(cacheKey);

    if (cached) {
      res.status(200).json({ ...cached, cached: true });
      return;
    }

    const huntdResult = await lookupCompetitorData(profileData.companyDomain, COMPETITOR_SOURCES);
    const allContacts = flattenCompetitorContacts(huntdResult);
    const directMatches = allContacts.filter((contact) => matchesProfile(contact, linkedinUrl, profileData));
    const fallbackCompanyContacts = allContacts.filter((contact) =>
      String(contact.company || '').toLowerCase().includes(profileData.companyName.toLowerCase()) ||
      String(contact.email || '').toLowerCase().endsWith(`@${profileData.companyDomain.toLowerCase()}`)
    );
    const selectedContacts = directMatches.length > 0 ? directMatches : fallbackCompanyContacts;

    const competitorTools = Object.entries(huntdResult)
      .filter(([, contacts]) => Array.isArray(contacts) && contacts.length > 0)
      .map(([toolName, contacts]) => {
        const toolContacts = selectedContacts.filter((contact) => contact.toolName === toolName);
        return {
          toolName,
          contacts: (toolContacts.length > 0 ? toolContacts : contacts).slice(0, 3)
        };
      })
      .filter((tool) => tool.contacts.length > 0);

    const icpScore = scoreICP({
      jobTitle: profileData.jobTitle,
      companySize: parsedCompanySize(profileData.companySize),
      tenureMonths: profileData.tenureMonths,
      linkedinActivityDays: profileData.linkedinActivityDays,
      competitorTools: Object.keys(huntdResult).filter((toolName) => Array.isArray(huntdResult[toolName]) && huntdResult[toolName].length > 0)
    });

    const response = {
      cached: false,
      profile: {
        fullName: profileData.fullName,
        jobTitle: profileData.jobTitle,
        companyName: profileData.companyName,
        linkedinUrl
      },
      competitorTools,
      icpScore,
      huntdDashboardUrl: `https://app.gethuntd.com/dashboard?domain=${encodeURIComponent(profileData.companyDomain)}`,
      fetchedAt: new Date().toISOString()
    };

    setCache(cacheKey, response);
    res.status(200).json(response);
  } catch (error) {
    logger.error('Failed to build profile enrichment', {
      message: error.message || 'Unknown error',
      stack: error.stack
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
