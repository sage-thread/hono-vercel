import { Hono } from "hono";

const app = new Hono();

// Only allow these domains
const allowedDomains = ["pixeldrain.com", "cdn.pixeldrain.com"];

// Error handler
function handleError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

// Proxy route
app.get("/", async (c) => {
  try {
    // Accept either ?url=... or ?id=...
    const urlParam = c.req.query("url");
    const idParam = c.req.query("id");

    let targetUrl: string | null = null;

    if (urlParam) {
      targetUrl = urlParam;
    } else if (idParam) {
      // Construct Pixeldrain API download URL
      targetUrl = `https://pixeldrain.com/api/file/${idParam}?download`;
    } else {
      return c.text("Missing url or id parameter", 400);
    }

    const target = new URL(targetUrl);
    if (!allowedDomains.includes(target.hostname)) {
      return c.text("Domain not allowed", 403);
    }

    // Fetch upstream file, forwarding Range header for resumable downloads
    const upstream = await fetch(target.toString(), {
      headers: {
        range: c.req.header("range") ?? "",
      },
    });

    // Mirror response: stream body + headers
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (error) {
    return c.text(`Error: ${handleError(error)}`, 500);
  }
});

export default app;
