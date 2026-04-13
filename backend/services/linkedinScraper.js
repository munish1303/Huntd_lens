function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function normalizeProfileData(profileData = {}) {
  const companyName = normalizeString(profileData.companyName, 'Unknown Company');
  const rawDomain = normalizeString(profileData.companyDomain, '');
  // If no domain was provided, derive one from the company name
  const companyDomain = rawDomain ||
    companyName.toLowerCase().replace(/[^a-z0-9]+/g, '').trim() + '.com';

  return {
    fullName: normalizeString(profileData.fullName, 'Unknown Profile'),
    jobTitle: normalizeString(profileData.jobTitle, 'Unknown Title'),
    companyName,
    companyDomain,
    companySize: normalizeString(profileData.companySize, 'Unknown'),
    tenureMonths: normalizeNumber(profileData.tenureMonths, 12),
    linkedinActivityDays: normalizeNumber(profileData.linkedinActivityDays, 30)
  };
}
