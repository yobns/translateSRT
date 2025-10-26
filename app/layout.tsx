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
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <div>
          <header className="sticky top-0 z-50">
            <div className="mx-auto max-w-3xl px-6">
              <ResponsiveLogo />
            </div>
          </header>
          <main className="min-h-screen pt-0 sm:pt-0 -mt-6 sm:-mt-4 lg:mt-0">
            <div id="logo-sentinel" className="h-px w-full" />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
