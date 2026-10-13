// ── Route-level async error safety for Express 4 ─────────────────────────────
// Express 4 ignores the promise an async handler returns, so a rejected
// await anywhere outside a try/catch becomes an unhandled rejection: the
// request hangs and Node (≥15) exits. installAsyncSafety walks the app's
// router tree once at startup and wraps every handler so rejections are
// passed to next(err) and reach the JSON error handler instead.

function wrap(handler) {
  if (typeof handler !== 'function' || handler.length >= 4 || handler.__asyncSafe) return handler;
  const wrapped = function asyncSafeHandler(req, res, next) {
    try {
      const out = handler.call(this, req, res, next);
      if (out && typeof out.then === 'function') out.catch(next);
      return out;
    } catch (err) {
      return next(err);
    }
  };
  wrapped.__asyncSafe = true;
  return wrapped;
}

function walk(stack, seen) {
  for (const layer of stack || []) {
    if (layer.route) {
      for (const inner of layer.route.stack) inner.handle = wrap(inner.handle);
    } else if (layer.handle?.stack) {
      // Mounted router: recurse once.
      if (seen.has(layer.handle)) continue;
      seen.add(layer.handle);
      walk(layer.handle.stack, seen);
    } else {
      layer.handle = wrap(layer.handle);
    }
  }
}

/** Call after every route is registered and before app.listen(). */
export function installAsyncSafety(app) {
  walk(app._router?.stack, new Set());
}
