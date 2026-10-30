import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context. Background work started inside a request (agent runs) inherits it, so LLM
 * usage is attributed to the right user without threading a userId through every call.
 */
export const requestContext = new AsyncLocalStorage<{ userId?: string }>();
export const currentUserId = () => requestContext.getStore()?.userId ?? null;
