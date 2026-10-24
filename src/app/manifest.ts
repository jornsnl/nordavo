import type { MetadataRoute } from "next";

/** Lets people install the portal on their phone and open it full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nordavo Portal",
    short_name: "Nordavo",
    description: "Het portaal van Nordavo: klanten, vacatures, kandidaten en plaatsingen.",
    lang: "nl",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f8fb",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
