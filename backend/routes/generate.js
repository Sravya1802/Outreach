import { Router } from 'express';
import { one, run } from '../db.js';
import { generateOutreach, generateWaaSMessage, generateCoverLetter } from '../services/ai.js';
import { DEFAULT_OUTREACH_TEMPLATES, normalizeOutreachTemplates } from '../services/outreachTemplates.js';
import { loadSenderProfile } from '../services/senderProfile.js';

const router = Router();
const TEMPLATE_META_KEY = 'outreach_templates';

async function getContactInfo(contactId, userId) {
  return one(`
    SELECT contacts.*,
           COALESCE(companies.name, contacts.name) as company_name,
           COALESCE(companies.role, '') as company_role,
           COALESCE(companies.stage, 'startup') as company_stage
    FROM contacts
    LEFT JOIN companies ON contacts.company_id = companies.id AND companies.user_id = $2
    WHERE contacts.id = $1 AND contacts.user_id = $2
  `, [contactId, userId]);
}

async function getUserTemplates(userId) {
  const row = await one(
    'SELECT value FROM meta WHERE user_id = $1 AND key = $2',
    [userId, TEMPLATE_META_KEY]
  );
  if (!row?.value) return null;
  try {
    return normalizeOutreachTemplates(JSON.parse(row.value));
  } catch {
    return null;
  }
}

router.get('/templates', async (req, res) => {
  try {
    const saved = await getUserTemplates(req.user.id);
    res.json({
      templates: saved || DEFAULT_OUTREACH_TEMPLATES,
      defaults: DEFAULT_OUTREACH_TEMPLATES,
      customized: !!saved,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/templates', async (req, res) => {
  try {
    const templates = normalizeOutreachTemplates(req.body || {});
    await run(
      `INSERT INTO meta (user_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [req.user.id, TEMPLATE_META_KEY, JSON.stringify(templates)]
    );
    res.json({ templates, customized: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Generate cold email
router.post('/email', async (req, res) => {
  try {
    const { contactId, companyName, recipientName, recipientTitle, extraContext, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter } = req.body;

    let name, title, company, stage, role;

    if (contactId) {
      const contact = await getContactInfo(contactId, req.user.id);
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      name = contact.name; title = contact.title; company = contact.company_name;
      stage = contact.company_stage; role = contact.company_role;
    } else {
      name = recipientName; title = recipientTitle; company = companyName;
      stage = 'startup'; role = '';
    }

    const customTemplates = await getUserTemplates(req.user.id);
    const result = await generateOutreach({
      type: 'cold_email',
      recipientName: name, recipientTitle: title, companyName: company,
      companyStage: stage, role, extraContext, hasApplied, rolesAvailable,
      specificAchievement, position, isRecruiter, customTemplates,
      sender: await loadSenderProfile(req.user.id),
    });

    if (contactId) {
      await run(`
        INSERT INTO outreach (contact_id, type, subject, body, status, user_id)
        VALUES ($1, 'email', $2, $3, 'draft', $4)
      `, [contactId, result.subject, result.body, req.user.id]);
    }

    res.json(result);
  } catch (err) {
    console.error('Generate email error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Generate LinkedIn message
router.post('/linkedin', async (req, res) => {
  try {
    const { contactId, companyName, recipientName, recipientTitle, extraContext, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter } = req.body;

    let name, title, company, stage, role;

    if (contactId) {
      const contact = await getContactInfo(contactId, req.user.id);
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      name = contact.name; title = contact.title; company = contact.company_name;
      stage = contact.company_stage; role = contact.company_role;
    } else {
      name = recipientName; title = recipientTitle; company = companyName;
      stage = 'startup'; role = '';
    }

    const customTemplates = await getUserTemplates(req.user.id);
    const result = await generateOutreach({
      type: 'linkedin',
      recipientName: name, recipientTitle: title, companyName: company,
      companyStage: stage, role, extraContext, hasApplied, rolesAvailable,
      specificAchievement, position, isRecruiter, customTemplates,
      sender: await loadSenderProfile(req.user.id),
    });

    if (contactId) {
      await run(`
        INSERT INTO outreach (contact_id, type, subject, body, status, user_id)
        VALUES ($1, 'linkedin', NULL, $2, 'draft', $3)
      `, [contactId, result.message || result.body, req.user.id]);
    }

    res.json(result);
  } catch (err) {
    console.error('Generate LinkedIn error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Generate both at once
router.post('/both', async (req, res) => {
  try {
    const { contactId, companyName, recipientName, recipientTitle, extraContext, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter } = req.body;

    let name, title, company, stage, role;

    if (contactId) {
      const contact = await getContactInfo(contactId, req.user.id);
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      name = contact.name; title = contact.title; company = contact.company_name;
      stage = contact.company_stage; role = contact.company_role;
    } else {
      name = recipientName; title = recipientTitle; company = companyName;
      stage = 'startup'; role = '';
    }

    const customTemplates = await getUserTemplates(req.user.id);
    const params = { recipientName: name, recipientTitle: title, companyName: company, companyStage: stage, role, extraContext, hasApplied, rolesAvailable, specificAchievement, position, isRecruiter, customTemplates, sender: await loadSenderProfile(req.user.id) };

    const [email, linkedin] = await Promise.all([
      generateOutreach({ ...params, type: 'cold_email' }),
      generateOutreach({ ...params, type: 'linkedin' }),
    ]);

    if (contactId) {
      await run(`INSERT INTO outreach (contact_id, type, subject, body, status, user_id) VALUES ($1, 'email', $2, $3, 'draft', $4)`, [contactId, email.subject, email.body, req.user.id]);
      await run(`INSERT INTO outreach (contact_id, type, subject, body, status, user_id) VALUES ($1, 'linkedin', NULL, $2, 'draft', $3)`, [contactId, linkedin.message || linkedin.body, req.user.id]);
    }

    res.json({ email, linkedin });
  } catch (err) {
    console.error('Generate both error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Generate WaaS (Work at a Startup) direct message
router.post('/waas', async (req, res) => {
  try {
    const { companyName, companyDescription, industry, ycBatch, contactName, extraContext } = req.body;
    if (!companyName) return res.status(400).json({ error: 'companyName required' });

    const result = await generateWaaSMessage({ companyName, companyDescription, industry, ycBatch, contactName, extraContext, sender: await loadSenderProfile(req.user.id) });

    if (req.body.contactId) {
      try {
        await run(
          "INSERT INTO outreach (contact_id, type, body, status, user_id) VALUES ($1, 'waas', $2, 'draft', $3)",
          [req.body.contactId, result.message, req.user.id]
        );
      } catch (_) {}
    }

    res.json(result);
  } catch (err) {
    console.error('Generate WaaS error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Generate cover letter
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
