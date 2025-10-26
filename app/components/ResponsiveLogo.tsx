"use client";
import { useEffect, useState } from "react";

export default function ResponsiveLogo() {
  const [visible, setVisible] = useState(true);
  const [imgSrc, setImgSrc] = useState<string>("/logo.png");

  useEffect(() => {
    const sentinel = document.getElementById("logo-sentinel");
    if (!sentinel) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      {
        root: null,
        threshold: 0,
        rootMargin: "-2px 0px 0px 0px",
      }
    );

    obs.observe(sentinel);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const prefersDark = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const hasDarkClass = () => document.documentElement.classList.contains("dark");

    const update = () => {
      setImgSrc(prefersDark() || hasDarkClass() ? "/logoWhite.png" : "/logo.png");
    };

    update();

    let mql: MediaQueryList | null = null;
    if (window.matchMedia) {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => update();
      if (mql.addEventListener) mql.addEventListener("change", handler);
      else if (mql.addListener) mql.addListener(handler as any);
    }

    const mo = new MutationObserver(() => update());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      if (mql) {
        if (mql.removeEventListener) mql.removeEventListener("change", update as any);
        else if (mql.removeListener) mql.removeListener(update as any);
      }
      mo.disconnect();
    };
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
          <img src={imgSrc} alt="SRT Translate" className="logo-img object-contain h-full w-full" />
        </picture>
      </div>
    </a>
  );
}
