import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Nordavo Portal",
    template: "%s · Nordavo Portal",
  },
  description:
    "Het portaal van Nordavo: de brug tussen Nederlandse groeibedrijven en Indiaas tech talent.",
  robots: { index: false, follow: false },
  applicationName: "Nordavo",
  // Added to the home screen, the portal opens full screen like an app.
  appleWebApp: {
    capable: true,
    title: "Nordavo",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and home indicator; the shells pad with safe-area insets.
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout instead of covering sticky bars.
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="nl"
      className={`${inter.variable} ${jakarta.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
