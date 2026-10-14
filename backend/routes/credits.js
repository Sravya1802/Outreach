import { Router } from 'express';
import { checkAllCredits } from '../services/creditChecker.js';
import { usageThisMonth } from '../services/providerUsage.js';
import { usageSummary } from '../services/llm.js';

const router = Router();

router.get('/status', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const status = await checkAllCredits(force);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// This user's share of the shared provider keys this month: { hunter: { used, limit }, … }
router.get('/usage', async (req, res) => {
  res.json({ usage: await usageThisMonth(req.user.id) });
});

// AI spend this month for the signed-in user and the whole site, against the caps.
router.get('/ai-usage', async (req, res) => {
  try {
    res.json(await usageSummary(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
