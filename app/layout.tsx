import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ResponsiveLogo from "./components/ResponsiveLogo";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "SRT Translate",
  description: "Translate your subtitles with AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        {/* Fixed top-left logo to keep a consistent SaaS branding */}
        <div>
          {/* logo aligned with the main content container; sticky so it stays above content but gains side spacing on wide screens */}
          <header className="sticky top-0 z-50">
            <div className="mx-auto max-w-3xl px-6">
              {/* client-controlled responsive logo (will hide when you scroll past the sentinel) */}
              <ResponsiveLogo />
            </div>
          </header>
          <main className="min-h-screen pt-0 sm:pt-0 -mt-6 sm:-mt-4 lg:mt-0">
            {/* sentinel observed by the client logo component; when this leaves the viewport the logo will hide */}
            <div id="logo-sentinel" className="h-px w-full" />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
