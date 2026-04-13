import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

const buildMockData = (domain) => ({
  Gong: [
    {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: `alex.rivera@${domain}`,
      company: domain,
      jobTitle: 'VP Sales',
      linkedinUrl: 'https://linkedin.com/in/alex-rivera',
      linkedinActivityDays: 5
    }
  ],
  Retool: [],
  HubSpot: [
    {
      firstName: 'Jamie',
      lastName: 'Chen',
      email: `jamie.chen@${domain}`,
      company: domain,
      jobTitle: 'Marketing Director',
      linkedinUrl: 'https://linkedin.com/in/jamie-chen',
      linkedinActivityDays: 22
    }
  ]
});

export async function lookupCompetitorData(domain, sources = []) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${process.env.HUNTD_API_BASE}/external/company-lookup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HUNTD_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ domain, sources }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('Huntd API returned an error', {
        domain,
        status: response.status,
        body: errorBody
      });

      throw {
        code: 'HUNTD_ERROR',
        message: `Huntd API request failed with status ${response.status}`,
        status: response.status
      };
    }

    return await response.json();
  } catch (error) {
    logger.error('Huntd API lookup failed', {
      domain,
      message: error.message || error,
      status: error.status || 500
    });

    if (process.env.NODE_ENV === 'development') {
      return buildMockData(domain);
    }

    throw {
      code: 'HUNTD_ERROR',
      message: error.message || 'Failed to fetch competitor data from Huntd',
      status: error.status || 500
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
