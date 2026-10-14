// Who the current request is for, without threading userId through every
// helper. Set once per request after auth; read by services that meter usage.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/** Express middleware: run the rest of the request with the signed-in user in context. */
export function requestContext(req, res, next) {
  store.run({ userId: req.user?.id ?? null }, next);
}

/** Run fn with an explicit user (crons and background jobs). */
export function withUser(userId, fn) {
  return store.run({ userId: userId ?? null }, fn);
}

export function currentUserId() {
  return store.getStore()?.userId ?? null;
}
