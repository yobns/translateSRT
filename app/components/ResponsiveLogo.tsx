"use client";
import { useEffect, useState } from "react";

export default function ResponsiveLogo() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const sentinel = document.getElementById("logo-sentinel");
    if (!sentinel) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        // When the sentinel is visible (not scrolled past) show the logo.
        setVisible(entry.isIntersecting);
      },
      {
        root: null,
        threshold: 0,
        // trigger slightly earlier/later if needed
        rootMargin: "-2px 0px 0px 0px",
      }
    );

    obs.observe(sentinel);
    return () => obs.disconnect();
  }, []);

  return (
    <a
      href="/"
      aria-label="Home - SRT Translate"
      className={`inline-flex items-center py-0 sm:py-0 -translate-x-2 sm:-translate-x-8 translate-y-0 sm:translate-y-0 overflow-visible transition-opacity duration-300 transform ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="relative h-28 w-28 sm:h-32 sm:w-32">
        <picture>
          <source srcSet="/logoWhite.png" media="(prefers-color-scheme: dark)" />
          <img src="/logo.png" alt="SRT Translate" className="logo-img object-contain h-full w-full" />
        </picture>
      </div>
    </a>
  );
}
