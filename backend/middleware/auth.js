export default function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.EXTENSION_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
