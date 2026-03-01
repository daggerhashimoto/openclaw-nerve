import type { MiddlewareHandler } from 'hono';
import {
  INSTANCE_ID_QUERY_PARAM,
  isProxyEligibleApiPath,
  isValidInstanceId,
  resolveRequestedInstanceId,
} from '../lib/instance-routing.js';
import { proxyToInstance, toProxyErrorResponse } from '../lib/instance-proxy.js';

export const instanceRoutingMiddleware: MiddlewareHandler = async (c, next) => {
  const reqUrl = new URL(c.req.url);
  const instanceId = resolveRequestedInstanceId(reqUrl, c.req.raw.headers);
  if (!instanceId || !isValidInstanceId(instanceId)) {
    await next();
    return;
  }

  if (!isProxyEligibleApiPath(reqUrl.pathname)) {
    await next();
    return;
  }

  try {
    const method = c.req.method.toUpperCase();
    const forwardedParams = new URLSearchParams(reqUrl.searchParams);
    forwardedParams.delete(INSTANCE_ID_QUERY_PARAM);
    const forwardedSearch = forwardedParams.toString();
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const payload = await c.req.raw.arrayBuffer();
      if (payload.byteLength > 0) body = payload;
    }

    return await proxyToInstance({
      instanceId,
      path: reqUrl.pathname,
      search: forwardedSearch ? `?${forwardedSearch}` : '',
      method,
      headers: c.req.raw.headers,
      body,
    });
  } catch (err) {
    return toProxyErrorResponse(err);
  }
};
