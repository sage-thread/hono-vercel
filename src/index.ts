import { Hono } from "hono";

const app = new Hono();

// Only allow these domains
const allowedDomains = ["pixeldrain.com", "cdn.pixeldrain.com"];

function handleError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

app.get("/", async (c) => {
  try {
    const urlParam = c.req.query("url");
    const idParam = c.req.query("id");

    let targetUrl: string | null = null;

    if (urlParam) {
      targetUrl = urlParam;
    } else if (idParam) {
      targetUrl = `https://pixeldrain.com/api/file/${idParam}?download`;
    } else {
      return c.text("Missing url or id parameter", 400);
    }

    const target = new URL(targetUrl);
    if (!allowedDomains.includes(target.hostname)) {
      return c.text("Domain not allowed", 403);
    }

    const rangeHeader = c.req.header("range") ?? "";

    const upstream = await fetch(target.toString(), {
      headers: rangeHeader ? { range: rangeHeader } : {},
    });

    const headers = new Headers(upstream.headers);

    // Mirror response: stream body + headers
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return c.text(`Error: ${handleError(error)}`, 500);
  }
});

export default app;
