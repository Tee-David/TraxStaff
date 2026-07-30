import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing/Nav";
import { Hero } from "@/components/marketing/Hero";
import { PlatformStrip } from "@/components/marketing/PlatformStrip";
import { Features } from "@/components/marketing/Features";
import { Philosophy } from "@/components/marketing/Philosophy";
import { DownloadCta } from "@/components/marketing/DownloadCta";
import { Footer } from "@/components/marketing/Footer";

// This route only ever renders for the marketing hostnames (traxstaff.com,
// www.traxstaff.com) — `middleware.ts` redirects every other hostname
// (app.traxstaff.com, Vercel previews, localhost) to `/app` before the
// request reaches here. See `middleware.ts` for why the split happens there
// instead of a `headers()` check in this file.
export const metadata: Metadata = {
  title: "Trax — Time tracking your team can actually see",
  description:
    "Trax tracks work time on Windows, Linux and Android with a visible, always-on indicator. Tamper-evident by design, never covert.",
};

export default function Home() {
  const currentYear = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-canvas">
      <MarketingNav />
      <Hero />
      <PlatformStrip />
      <Features />
      <Philosophy />
      <DownloadCta />
      <Footer currentYear={currentYear} />
    </main>
  );
}
