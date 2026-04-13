function getTitleScore(jobTitle = '') {
  if (/(ceo|cro|vp|chief)/i.test(jobTitle)) return 30;
  if (/(director|head)/i.test(jobTitle)) return 22;
  if (/(manager|lead)/i.test(jobTitle)) return 15;
  return 8;
}

function getCompanySizeScore(companySize = 0) {
  if (companySize >= 11 && companySize <= 200) return 20;
  if (companySize >= 201 && companySize <= 500) return 18;
  if (companySize >= 501 && companySize <= 1000) return 14;
  if (companySize >= 1 && companySize <= 10) return 10;
  if (companySize > 1000) return 8;
  return 8;
}

function getTenureScore(tenureMonths = 0) {
  if (tenureMonths >= 12 && tenureMonths <= 36) return 20;
  if (tenureMonths >= 6 && tenureMonths < 12) return 15;
  if (tenureMonths > 36 && tenureMonths <= 60) return 12;
  if (tenureMonths > 60) return 8;
  return 5;
}

function getActivityScore(linkedinActivityDays = 999) {
  if (linkedinActivityDays <= 7) return 20;
  if (linkedinActivityDays <= 14) return 16;
  if (linkedinActivityDays <= 30) return 10;
  if (linkedinActivityDays <= 60) return 5;
  return 0;
}

export function scoreICP(profileData) {
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
}
