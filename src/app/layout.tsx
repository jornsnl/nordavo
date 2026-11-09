import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { PwaSupport } from "@/components/pwa/pwa-support";
import { Toaster } from "@/components/ui/toaster";

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
    "The Nordavo portal: the bridge between Dutch scale-ups and Indian tech talent.",
  robots: { index: false, follow: false },
  applicationName: "Nordavo",
  formatDetection: { telephone: false },
  // The manifest and the home screen tags are in the layouts of the
  // installable part only (installableMetadata): public pages such as the
  // application form must not offer to install the portal.
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
      lang="en"
      className={`${inter.variable} ${jakarta.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        {children}
        <PwaSupport />
        <Toaster />
      </body>
    </html>
  );
}
