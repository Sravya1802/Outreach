import { one } from '../db.js';
import { parseId } from '../services/safePaths.js';

/**
 * Require req.params[param] to be an integer id of a company (jobs row) the
 * caller owns. Runs BEFORE multer so an upload can never be written for a
 * crafted id ("..%2F..%2Ftmp") or someone else's company. Normalises the
 * param to the integer so later path.join calls only ever see digits.
 */
export function requireOwnedCompany(param = 'id') {
  return async (req, res, next) => {
    try {
      const id = parseId(req.params[param]);
      if (!id) return res.status(400).json({ error: 'Invalid company id' });
      const owned = await one('SELECT id FROM jobs WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      if (!owned) return res.status(404).json({ error: 'Company not found' });
      req.params[param] = String(id);
      next();
    } catch (err) {
      next(err);
    }
  };
}
