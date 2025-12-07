import { Hono } from "hono";
import { handle } from "hono/vercel";

export const config = {
  runtime: "edge",
};

const app = new Hono();

const allowedDomains = ["pixeldrain.com", "cdn.pixeldrain.com"];
const allowedASNs = ["AS13335", "AS812"]; // Cloudflare + Rogers

// Utilities
function isPrivateIp(ip: string) {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.")
  );
}

function getClientIp(c: any): string | null {
  const xf = c.req.header("x-forwarded-for");
  const xr = c.req.header("x-real-ip");
  return xf?.split(",")[0]?.trim() || xr?.trim() || null;
}

async function fetchASN(ip: string, timeoutMs = 3000): Promise<string | null> {
  const res = await fetch(`https://ipapi.co/${ip}/json/`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.asn ?? null;
}

// IP + ASN check
app.use("*", async (c, next) => {
  const ip = getClientIp(c);
  if (!ip) return c.text("No IP detected", 403);

  if (!isPrivateIp(ip)) {
    try {
      const asn = await fetchASN(ip);
      if (!asn || !allowedASNs.includes(asn)) {
        return c.text("We’re not live in your region yet", 403);
      }
    } catch (err) {
      console.error("ASN lookup error:", err);
      return c.text("ASN lookup timed out", 403);
    }
  }

  await next();
});

// Root
app.get("/", (c) => c.text("Hello Hono + Vercel Edge!"));

// IP diagnostic route
app.get("/ip", async (c) => {
  const ip = getClientIp(c);
  if (!ip) return c.json({ error: "No IP detected" }, 403);

  let asn: string | null = null;
  try {
    asn = await fetchASN(ip);
  } catch (err) {
    console.error("ASN lookup failed:", err);
  }

  return c.json({
    ip,
    private: isPrivateIp(ip),
    asn,
    allowed: isPrivateIp(ip) || !!(asn && allowedASNs.includes(asn)),
  });
});

// Proxy route
app.get("/api", async (c) => {
  const origin = c.req.query("origin");
  const id = c.req.query("id");

  let targetUrl: string | null = null;
  if (origin) targetUrl = origin;
  else if (id) targetUrl = `https://pixeldrain.com/api/file/${id}?download`;

  if (!targetUrl) {
    return c.json({ error: "Missing required parameter" }, 400);
  }

  const parsedUrl = new URL(targetUrl);
  const isAllowedHost = allowedDomains.some(
    (host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`)
  );
  if (!isAllowedHost) {
    return c.json({ error: "Domain not allowed" }, 403);
  }

  try {
    const upstream = await fetch(targetUrl, { redirect: "follow" });
    if (!upstream.ok) {
      return c.json({ error: "Failed to fetch file" });
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const contentDisposition =
      upstream.headers.get("content-disposition") ||
      `attachment; filename="${parsedUrl.pathname.split("/").pop()}"`;

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
      },
    });
  } catch (err) {
    console.error("Proxy fetch error:", err);
    return c.json({ error: "Proxy error" }, 502);
  }
});

app.get("/limit", async (c) => {
  try {
    const res = await fetch("https://pixeldrain.com/api/misc/rate_limits");
    if (!res.ok) {
      return c.json({ error: "Failed to fetch rate limits" });
    }
    const data = await res.json();
    return c.json(data, 200);
  } catch (err) {
    console.error("Rate limit fetch error:", err);
    return c.json({ error: "Rate limit fetch error" }, 502);
  }
});

export default handle(app);
