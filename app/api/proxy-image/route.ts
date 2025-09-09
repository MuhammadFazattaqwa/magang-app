export async function GET(req: Request) {
  const u = new URL(req.url);
  const target = u.searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });

  const resp = await fetch(target);
  if (!resp.ok) return new Response("Failed to fetch image", { status: 502 });

  const blob = await resp.blob();
  return new Response(blob, {
    headers: {
      "Content-Type": resp.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
