import type { MetadataRoute } from "next";
import { appleStartupImages } from "./splash";

/** Where the manifest is served (src/app/manifest.webmanifest/route.ts). */
export const MANIFEST_PATH = "/manifest.webmanifest";

const icon = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];

/**
 * Lets people install the portal on their phone and open it full screen.
 * Linked only from the signed-in apps (installableMetadata), never from the
 * public pages (the application form, the Working Style link, invites), so
 * those do not offer to install the portal.
 */
export const manifest: MetadataRoute.Manifest = {
  name: "Nordavo Portal",
  short_name: "Nordavo",
  description: "The Nordavo portal: clients, vacancies, candidates, recruitment and Work.",
  lang: "en",
  id: "/",
  // The root sends everyone to their own home: team to /dashboard,
  // clients to /portal and Work guests to /work.
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f6f8fb",
  theme_color: "#ffffff",
  categories: ["business", "productivity"],
  shortcuts: [
    { name: "Add a task", short_name: "Add task", url: "/work/add", icons: icon },
    { name: "Overview", short_name: "Overview", url: "/dashboard", icons: icon },
    { name: "My tasks", short_name: "Tasks", url: "/work", icons: icon },
    { name: "Quick log", short_name: "Log", url: "/work/log", icons: icon },
    { name: "Leads", short_name: "Leads", url: "/dashboard/leads", icons: icon },
    { name: "Vacancies", short_name: "Vacancies", url: "/dashboard/vacancies", icons: icon },
  ],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

/**
 * Metadata for the layouts of the installable part (dashboard, Work, client
 * portal, Academy, callers, sign in): the manifest link and the iOS home
 * screen tags. The root layout has none of it.
 */
export const installableMetadata = {
  manifest: MANIFEST_PATH,
  // Added to the home screen, the portal opens full screen like an app.
  appleWebApp: {
    capable: true,
    title: "Nordavo",
    statusBarStyle: "default" as const,
    startupImage: appleStartupImages,
  },
  // Older iOS versions read this tag instead of the manifest for full screen.
  other: { "apple-mobile-web-app-capable": "yes" },
};
