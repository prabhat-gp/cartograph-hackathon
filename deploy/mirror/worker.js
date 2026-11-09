// Cartograph's public address, https://cartograph-app.pages.dev: a Cloudflare
// Pages project whose _worker.js is this file. Every request is passed through
// to the Oracle server unchanged and the response streamed back, so the site
// gets a plain name that resolves on every network.
const ORIGIN = "https://130-210-10-23.sslip.io";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = new URL(url.pathname + url.search, ORIGIN);

    const headers = new Headers(request.headers);
    // The server only accepts requests from its own origin; to it, the mirror is that origin.
    if (headers.has("origin")) headers.set("origin", ORIGIN);
    if (headers.has("referer")) headers.set("referer", ORIGIN + "/");
    // Every visitor here shares Cloudflare's address: pass the real one, signed,
    // so each visitor keeps their own hourly limits.
    const ip = request.headers.get("cf-connecting-ip");
    if (env.MIRROR_SECRET && ip) {
      headers.set("x-cartograph-mirror", env.MIRROR_SECRET);
      headers.set("x-cartograph-client-ip", ip);
    }

    const res = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      duplex: "half", // stream request bodies through (MCP, uploads)
    });

    // Keep redirects on the mirror, and let the browser talk to it as itself.
    const out = new Headers(res.headers);
    const location = out.get("location");
    if (location?.startsWith(ORIGIN)) out.set("location", url.origin + location.slice(ORIGIN.length));
    if (out.get("access-control-allow-origin") === ORIGIN) out.set("access-control-allow-origin", url.origin);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
};
