export function generateTemplate(profileData, competitorTools) {
  const firstName = (profileData.fullName || 'there').split(' ')[0];
  const toolList = Array.isArray(competitorTools) && competitorTools.length > 0
    ? competitorTools.map((tool) => tool.toolName).join(', ')
    : 'your current stack';
  const companySize = Number(profileData.companySize) || 0;

  let valueProp = 'consolidating their GTM stack';
  if (companySize < 50) {
    valueProp = 'moving fast without enterprise overhead';
  } else if (companySize < 500) {
    valueProp = 'scaling their outbound efficiently';
  }

  return `Hi ${firstName},

I noticed you're currently using ${toolList} at ${profileData.companyName}. We work with a lot of ${profileData.jobTitle}s who've found that ${valueProp}.

Would it make sense to connect for 15 minutes this week?

Best,
[Rep Name]`;
}
