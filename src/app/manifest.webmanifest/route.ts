import { manifest } from "@/lib/pwa/manifest";

/**
 * The web app manifest, as a route instead of app/manifest.ts: Next links
 * that one from every page, the public ones too. This one is linked only
 * from the installable part (installableMetadata).
 */
export function GET() {
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
