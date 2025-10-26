import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SRT Translate",
    short_name: "SRT",
    description: "Translate your subtitles with AI",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111827",
    icons: [
      // You can add sized icons later in public/ and list them here
      { src: "/favicon.ico", sizes: "48x48 64x64", type: "image/x-icon" },
    ],
  };
}
