import type { Metadata } from "next";
import TargetCursor from "@/components/marketing/TargetCursor";
import { MarketingNav } from "@/components/marketing/Nav";
import { Hero } from "@/components/marketing/Hero";
import { Features } from "@/components/marketing/Features";
import { Showcase } from "@/components/marketing/Showcase";
import { Integrity } from "@/components/marketing/Integrity";
import { Testimonials } from "@/components/marketing/Testimonials";
import { Statements } from "@/components/marketing/Statements";
import { Transparency } from "@/components/marketing/Transparency";
import { DownloadCta } from "@/components/marketing/DownloadCta";
import { Footer } from "@/components/marketing/Footer";

// This route only ever renders for the marketing hostnames (traxstaff.com,
// www.traxstaff.com) — `middleware.ts` redirects every other hostname
// (app.traxstaff.com, Vercel previews, localhost) to `/app` before the
// request reaches here. See `middleware.ts` for why the split happens there
// instead of a `headers()` check in this file.
export const metadata: Metadata = {
  title: "TraxStaff — Time tracking your team can actually see",
  description:
    "TraxStaff tracks work time on Windows, Linux and Android with a visible, always-on indicator. Tamper-evident by design, never covert.",
};

export default function Home() {
  const currentYear = new Date().getFullYear();

  return (
    <main className="mk-page min-h-screen bg-canvas">
      {/* Renders nothing on touch devices or under prefers-reduced-motion —
          it hides the system pointer, so it must not be the only cursor a
          visitor has. */}
      <TargetCursor spinDuration={2} hideDefaultCursor parallaxOn hoverDuration={0.2} cursorColor="#ff6600" />
      <MarketingNav />
      {/* The platform strip is inside `Hero` now — it's the bottom row of the
          one screen the hero fills, not a band underneath it. */}
      <Hero />
      <Features />
      <Showcase />
      {/* Social proof straight after the feature case, then the two honesty
          sections, then the positions as the closing argument before the CTA.
          The ordering also keeps the page's two marquees apart — back to back
          they read as one widget shown twice. */}
      <Testimonials />
      <Integrity />
      <Transparency />
      <Statements />
      <DownloadCta />
      <Footer currentYear={currentYear} />
    </main>
  );
}
