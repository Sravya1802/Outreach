// The cover letter writer. The app writes no outreach: emails and LinkedIn
// notes come from the user's Claude run (tailoring_config.email_template).
import { Router } from 'express';
import { one } from '../db.js';
import { generateCoverLetter } from '../services/ai.js';
import { loadSenderProfile } from '../services/senderProfile.js';

const router = Router();

router.post('/cover-letter', async (req, res) => {
  try {
    const { companyId, roleTitle, extraContext } = req.body;
    let companyName = 'this company';
    let companyDescription = '';

    if (companyId) {
      const company = await one(
        'SELECT * FROM jobs WHERE id = $1 AND user_id = $2',
        [companyId, req.user.id]
      );
      if (company) {
        companyName = company.name;
        companyDescription = company.description || company.wikipedia_summary || '';
      }
    } else if (req.body.companyName) {
      companyName = req.body.companyName;
      companyDescription = req.body.companyDescription || '';
    }

    const result = await generateCoverLetter({ companyName, companyDescription, roleTitle, extraContext, sender: await loadSenderProfile(req.user.id) });
    res.json(result);
  } catch (err) {
    console.error('Cover letter error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
