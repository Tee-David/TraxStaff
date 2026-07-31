import type { Metadata } from "next";
import { Space_Grotesk, Outfit } from "next/font/google";
import { ASSETS_URL } from "@/lib/site";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TraxStaff",
  description: "Time tracking & productivity for your team",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${outfit.variable}`} suppressHydrationWarning>
      <head>
        {/* The hero's background tiles are served from our R2 bucket, and they
            are above the fold — so the DNS lookup, TCP handshake and TLS
            negotiation for that host all sit on the critical path unless they
            start early. `preconnect` does all three before the CSS that
            references them has even been parsed. */}
        <link rel="preconnect" href={ASSETS_URL} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={ASSETS_URL} />

        {/* Apply saved theme before paint to avoid a flash; mark the doc as
            already-loaded so the first-load preloader plays once per session. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('trax_theme')||'light';document.documentElement.dataset.theme=t;if(sessionStorage.getItem('trax_intro')){document.documentElement.setAttribute('data-preloaded','1');}else{sessionStorage.setItem('trax_intro','1');}}catch(e){}`,
          }}
        />
        {/* The marketing page reveals sections on scroll, and Framer inlines
            the pre-animation state (opacity:0) straight into the server-
            rendered markup. With no JS those reveals never run, which would
            leave everything below the fold invisible to a non-JS visitor or
            crawler. Scoped to .mk-page so the dashboard is untouched. */}
        <noscript>
          <style>{`.mk-page [style*="opacity:0"]{opacity:1!important;transform:none!important}.mk-page .mk-mark-stroke{clip-path:none!important}`}</style>
        </noscript>
      </head>
      <body>
        {/* First-paint intro — see #trax-preloader in globals.css. */}
        <div id="trax-preloader" aria-hidden="true">
          <div className="trax-preloader-mark" />
        </div>
        {children}
      </body>
    </html>
  );
}
