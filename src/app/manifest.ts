import type { MetadataRoute } from "next";

/** Lets people install the portal on their phone and open it full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
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
      { name: "Dashboard", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Work", url: "/work", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
