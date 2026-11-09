import type { NextConfig } from "next";

// The portal used Dutch paths until November 2026. Old links (bookmarks, mails,
// Supabase auth e-mail templates) keep working through these redirects.
const dutchPaths: [string, string][] = [
  ["/auth/wachtwoord", "/auth/password"],
  ["/dashboard/campagnes", "/dashboard/sequences"],
  ["/dashboard/kandidaten", "/dashboard/candidates"],
  ["/dashboard/kandidaten/:id", "/dashboard/candidates/:id"],
  ["/dashboard/kandidaten/:id/cv", "/dashboard/candidates/:id/cv"],
  ["/dashboard/kandidaten/:id/bewerken", "/dashboard/candidates/:id/edit"],
  ["/dashboard/kandidaten/nieuw", "/dashboard/candidates/new"],
  ["/dashboard/klanten", "/dashboard/clients"],
  ["/dashboard/klanten/:id", "/dashboard/clients/:id"],
  ["/dashboard/klanten/:id/bewerken", "/dashboard/clients/:id/edit"],
  ["/dashboard/klanten/nieuw", "/dashboard/clients/new"],
  ["/dashboard/contacten", "/dashboard/contacts"],
  ["/dashboard/leads/nieuw", "/dashboard/leads/new"],
  ["/dashboard/lijsten", "/dashboard/call-lists"],
  ["/dashboard/plaatsingen", "/dashboard/placements"],
  ["/dashboard/plaatsingen/:id", "/dashboard/placements/:id"],
  ["/dashboard/plaatsingen/:id/bewerken", "/dashboard/placements/:id/edit"],
  ["/dashboard/plaatsingen/nieuw", "/dashboard/placements/new"],
  ["/dashboard/rapport", "/dashboard/report"],
  ["/dashboard/instellingen", "/dashboard/settings"],
  ["/dashboard/uitsluitingen", "/dashboard/suppressions"],
  ["/dashboard/taken", "/dashboard/tasks"],
  ["/dashboard/vacatures", "/dashboard/vacancies"],
  ["/dashboard/vacatures/:id", "/dashboard/vacancies/:id"],
  ["/dashboard/vacatures/:id/bewerken", "/dashboard/vacancies/:id/edit"],
  ["/dashboard/vacatures/:id/pipeline", "/dashboard/vacancies/:id/pipeline"],
  ["/dashboard/vacatures/:id/profielen/:profileId", "/dashboard/vacancies/:id/profiles/:profileId"],
  ["/dashboard/vacatures/nieuw", "/dashboard/vacancies/new"],
  ["/login/verificatie", "/login/verify"],
  ["/portaal", "/portal"],
  ["/portaal/cv/:applicationId", "/portal/cv/:applicationId"],
  ["/portaal/plaatsingen", "/portal/placements"],
  ["/portaal/beveiliging", "/portal/security"],
  ["/portaal/vacatures/:id", "/portal/vacancies/:id"],
];

// Lists and Campaigns were replaced by saved call lists and sequences (docs/sales.md).
const removedPaths: [string, string][] = [
  ["/dashboard/campaigns", "/dashboard/sequences"],
  ["/dashboard/lists", "/dashboard/call-lists"],
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  async redirects() {
    return [...dutchPaths, ...removedPaths].map(([source, destination]) => ({ source, destination, permanent: true }));
  },
  async headers() {
    return [
      {
        // The service worker must never be cached, so updates reach the home screen app.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // CV uploads go through a server action: 20 MB file plus form overhead.
      bodySizeLimit: "21mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
