import React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ResponsiveLogo from "./components/ResponsiveLogo";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "600", "700", "800"],
});

// Resolve site URL without relying on Node typings in this file
const siteUrl = (globalThis as any)?.process?.env?.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "SRT Translate",
    template: "%s | SRT Translate",
  },
  description: "Translate your subtitles with AI",
  keywords: [
    "SRT",
    "subtitle",
    "translate",
    "AI translation",
    "subtitles translator",
    "SRT translator",
  ],
  authors: [{ name: "SRT Translate" }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "SRT Translate",
    description: "Translate your subtitles with AI",
    url: "/",
    siteName: "SRT Translate",
    images: [
      {
        url: "/logo.png",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SRT Translate",
    description: "Translate your subtitles with AI",
    images: ["/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
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
