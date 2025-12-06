import { Hono } from "hono";
import { handle } from "hono/vercel";

export const config = {
  runtime: "edge",
};

const app = new Hono();

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

function getClientIpFromHeaders(c: any): string | null {
  // Edge runtime headers (Web Request)
  const xf = c.req.header("x-forwarded-for");
  const xr = c.req.header("x-real-ip");
  const ip = xf?.split(",")[0]?.trim() || xr?.trim() || null;
  return ip;
}

// IP/ASN filter
app.use("*", async (c, next) => {
  const ip = getClientIpFromHeaders(c);

  if (!ip) {
    return c.text(
      "We’re not live in your region yet, but stay tuned for future availability.",
      403
    );
  }

  // Allow private IPs for local dev and internal traffic
  if (isPrivateIp(ip)) {
    return await next();
  }

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!res.ok) {
      return c.text(
        "We’re not live in your region yet, but stay tuned for future availability.",
        403
      );
    }

    const { asn } = await res.json();
    const allowedASNs = ["AS13335", "AS812"]; // Cloudflare + Rogers
    if (!allowedASNs.includes(asn)) {
      return c.text(
        "We’re not live in your region yet, but stay tuned for future availability.",
        403
      );
    }

    await next();
  } catch {
    return c.text(
      "We’re not live in your region yet, but stay tuned for future availability.",
      403
    );
  }
});

// Root
app.get("/", (c) => c.text("Hello Hono + Vercel Edge!"));

// IP diagnostic route
app.get("/ip", async (c) => {
  const ip = getClientIpFromHeaders(c);

  if (!ip) {
    return c.json({ error: "No IP detected" }, { status: 403 });
  }

  const privateIp = isPrivateIp(ip);
  let asn: string | null = null;

try {
  const res = await fetch(`https://ipapi.co/${ip}/json/`);
  if (res.ok) {
    const data = await res.json();
    asn = data.asn || null;
  } else {
    return c.text("Failed to fetch ASN info", 502);
  }
} catch (err) {
  console.error("ASN lookup failed:", err);
  return c.text("Error looking up IP information", 502);
}


  const allowedASNs = ["AS13335", "AS812"];
  const allowed = privateIp || (asn && allowedASNs.includes(asn));

  return c.json({
    ip,
    private: privateIp,
    asn,
    allowed,
    message: allowed
      ? "IP is allowed"
      : "We’re not live in your region yet, but stay tuned for future availability.",
  });
});

// Proxy route
app.get("/api", async (c) => {
  const origin = c.req.query("origin");
  const id = c.req.query("id");

  let targetUrl: string | null = null;
  if (origin) {
    targetUrl = origin;
  } else if (id) {
    targetUrl = `https://pixeldrain.com/api/file/${id}?download`;
  }

  if (!targetUrl) {
    return c.json({ error: "Missing required parameter" }, { status: 400 });
  }

  const parsedUrl = new URL(targetUrl);
  const allowedHosts = [
    "pixeldrain.com",
    "pixeldra.in",
    "pixeldrain.net",
    "pixeldrain.dev",
  ];
  const isAllowedHost = allowedHosts.some(
    (host) =>
      parsedUrl.hostname === host || parsedUrl.hostname.endsWith(`.${host}`)
  );

  if (!isAllowedHost) {
    return c.json({ error: "Domain not allowed" }, { status: 403 });
  }

  const response = await fetch(targetUrl, { redirect: "follow" });
  if (!response.ok) {
    return new Response(JSON.stringify({ error: "Failed to fetch file" }), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const contentType =
    response.headers.get("content-type") || "application/octet-stream";
  const contentDisposition =
    response.headers.get("content-disposition") ||
    `attachment; filename="${parsedUrl.pathname.split("/").pop()}"`;

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition,
    },
  });
});

// Rate limit info
app.get("/limit", async (c) => {
  const res = await fetch("https://pixeldrain.com/api/misc/rate_limits");
  const data = await res.json();

  const percent = (
    (data.transfer_limit_used / data.transfer_limit) *
    100
  ).toFixed(2);
  const limitMB = (data.transfer_limit / 1e6).toFixed(2);
  const usedMB = (data.transfer_limit_used / 1e6).toFixed(2);

  return c.json({
    page: "Rate Limit Page",
    transfer_limit_used_percentage: `${percent}%`,
    transfer_limit: `${limitMB} MB`,
    transfer_limit_used: `${usedMB} MB`,
  });
});

export default handle(app);
