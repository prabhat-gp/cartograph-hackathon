// A mirror of Cartograph on workers.dev, for networks that can't resolve
// cartograph.duckdns.org (ISPs and company filters that block dynamic-DNS
// names, or that fail reaching DuckDNS's name servers). Every request is passed
// through to the real server unchanged and the response streamed back.
const ORIGIN = "https://cartograph.duckdns.org";

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
