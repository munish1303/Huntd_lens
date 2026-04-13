import rateLimit from 'express-rate-limit';

const profileRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
  }
});

export default profileRateLimit;
