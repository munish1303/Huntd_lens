import { Router } from 'express';
import fetch from 'node-fetch';
import authMiddleware from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// In-flight guard — one Gemini call per profile at a time
const inFlightKeys = new Set();

async function callGemini(profilePayload, geminiKey) {
  // Keep prompt minimal — thinking models use tokens for reasoning before output
  const prompt = `B2B sales analyst. Score this LinkedIn lead 0-100.

Name: ${profilePayload.identity.name}
Title: ${profilePayload.identity.headline}
Company: ${profilePayload.identity.company} (${profilePayload.identity.size})
Tenure: ${profilePayload.tenure_months} months
Last active: ${profilePayload.linkedin_activity_days} days ago
Rule-based score: ${profilePayload.rule_based_icp_score}/100

Respond with ONLY this JSON (no markdown, no explanation):
{"aiScore":72,"label":"Warm","reasoning":"One sentence here."}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048  // thinking models need headroom for reasoning tokens
        }
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    logger.error('Gemini HTTP error', { status: res.status, body: errText.slice(0, 400) });
    throw Object.assign(new Error(`Gemini ${res.status}`), { status: res.status, body: errText });
  }

  return res.json();
}

/**
 * Extract aiScore, label, reasoning from any text Gemini returns.
 * Handles: clean JSON, JSON inside markdown fences, thinking-model output,
 * and plain prose with numbers in it.
 */
function parseGeminiResponse(rawText) {
  if (!rawText) return null;

  // 1. Strip <think>...</think> blocks (gemini-2.5-flash thinking output)
  const stripped = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip markdown code fences
  const noFences = stripped.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();

  // 3. Try to find and parse a JSON object
  const jsonMatch = noFences.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.aiScore !== 'undefined') return parsed;
    } catch (_e) {}
  }

  // 4. Fallback: extract numbers and keywords from plain prose
  //    e.g. "I'd give this lead a score of 68 out of 100, which is Warm..."
  const scoreMatch = noFences.match(/\b(\d{1,3})\s*(?:\/\s*100|out of 100|points?)?/i);
  const score = scoreMatch ? Math.min(100, Math.max(0, Number(scoreMatch[1]))) : null;

  if (score === null) return null;

  const label = score >= 75 ? 'Hot' : score >= 50 ? 'Warm' : 'Cold';

  // Extract a sentence as reasoning — first sentence that isn't just a number
  const sentences = noFences.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
  const reasoning = sentences[0] || noFences.slice(0, 120);

  return { aiScore: score, label, reasoning };
}

router.post('/', authMiddleware, async (req, res) => {
  const { profileData, deepProfile, icpScore } = req.body || {};

  if (!profileData) {
    res.status(400).json({ error: 'profileData is required' });
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || geminiKey === 'your_gemini_api_key_here') {
    res.status(503).json({
      error: 'GEMINI_NOT_CONFIGURED',
      message: 'Set GEMINI_API_KEY in huntd-lens/backend/.env'
    });
    return;
  }

  const profilePayload = {
    identity: {
      name:     profileData.fullName     || 'Unknown',
      headline: profileData.jobTitle     || 'Unknown',
      company:  profileData.companyName  || 'Unknown',
      size:     profileData.companySize  || 'Unknown',
      location: deepProfile?.identity?.location || ''
    },
    tenure_months:          profileData.tenureMonths          || 12,
    linkedin_activity_days: profileData.linkedinActivityDays  || 30,
    rule_based_icp_score:   icpScore?.score                   ?? null
  };

  const requestKey = `${profileData.fullName}:${profileData.companyName}`;
  if (inFlightKeys.has(requestKey)) {
    res.status(429).json({ error: 'DUPLICATE', message: 'Analysis already in progress for this profile.' });
    return;
  }
  inFlightKeys.add(requestKey);

  try {
    const json    = await callGemini(profilePayload, geminiKey);

    // Pull text from response — handle empty parts (MAX_TOKENS with no output)
    const parts   = json?.candidates?.[0]?.content?.parts || [];
    const rawText = parts.map(p => p.text || '').join('').trim();
    const finishReason = json?.candidates?.[0]?.finishReason || '';

    logger.info('Gemini raw response', {
      finishReason,
      textLength: rawText.length,
      preview: rawText.slice(0, 200)
    });

    // If model stopped due to MAX_TOKENS with no text, return a computed fallback
    if (!rawText) {
      const fallbackScore = icpScore?.score ?? 50;
      const fallbackLabel = fallbackScore >= 75 ? 'Hot' : fallbackScore >= 50 ? 'Warm' : 'Cold';
      inFlightKeys.delete(requestKey);
      res.status(200).json({
        success: true,
        analysis: {
          aiScore:   fallbackScore,
          label:     fallbackLabel,
          reasoning: `AI model did not return text (${finishReason}). Showing rule-based score as fallback.`
        }
      });
      return;
    }

    const analysis = parseGeminiResponse(rawText);

    if (!analysis) {
      // Last resort — return rule-based score with the raw text as reasoning
      const fallbackScore = icpScore?.score ?? 50;
      const fallbackLabel = fallbackScore >= 75 ? 'Hot' : fallbackScore >= 50 ? 'Warm' : 'Cold';
      inFlightKeys.delete(requestKey);
      res.status(200).json({
        success: true,
        analysis: {
          aiScore:   fallbackScore,
          label:     fallbackLabel,
          reasoning: rawText.slice(0, 200)
        }
      });
      return;
    }

    // Normalise label from score
    const score = Number(analysis.aiScore) || 0;
    analysis.label = score >= 75 ? 'Hot' : score >= 50 ? 'Warm' : 'Cold';

    logger.info('AI score computed', { name: profileData.fullName, score, label: analysis.label });
    inFlightKeys.delete(requestKey);
    res.status(200).json({ success: true, analysis });

  } catch (err) {
    inFlightKeys.delete(requestKey);
    logger.error('Gemini call failed', { message: err.message, status: err.status });

    if (err.status === 429) {
      let detail = '';
      try { detail = JSON.parse(err.body)?.error?.message || ''; } catch (_e) {}
      res.status(429).json({
        error: 'RATE_LIMIT',
        message: detail || 'Gemini rate limit hit. Create a new Google Cloud project and generate a fresh API key.'
      });
      return;
    }
    if (err.status === 401 || err.status === 403) {
      res.status(401).json({ error: 'INVALID_KEY', message: 'Gemini API key is invalid. Check GEMINI_API_KEY in .env.' });
      return;
    }

    // For any other error, return rule-based score as fallback so sidebar always shows something
    const fallbackScore = icpScore?.score ?? 50;
    const fallbackLabel = fallbackScore >= 75 ? 'Hot' : fallbackScore >= 50 ? 'Warm' : 'Cold';
    res.status(200).json({
      success: true,
      analysis: {
        aiScore:   fallbackScore,
        label:     fallbackLabel,
        reasoning: `AI unavailable (${err.message}). Showing rule-based score.`
      }
    });
  }
});

export default router;
