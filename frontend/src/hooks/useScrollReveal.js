import { useEffect } from "react";

// Reveals elements with `.reveal` / `.reveal-chart` when they scroll into view,
// instead of firing their entrance animation on mount. That way content far
// down the page (e.g. the points charts) still animates when you actually reach
// it, rather than building itself while off-screen.
//
// Uses a scroll-position check (rather than IntersectionObserver) so it stays
// reliable everywhere and never leaves content stuck hidden. Handles async data
// loads and SPA route changes via a MutationObserver.
export function useScrollReveal() {
  useEffect(() => {
    const SEL = ".reveal, .reveal-chart, .cascade";
    let ticking = false;

    const reveal = () => {
      ticking = false;
      // Reveal once the element's top reaches the bottom 10% of the viewport,
      // so it animates in just before it's fully on screen.
      const trigger = window.innerHeight * 0.9;
      const due = [];
      document.querySelectorAll(SEL).forEach((el) => {
        if (el.classList.contains("is-visible")) return;
        const top = el.getBoundingClientRect().top;
        if (top < trigger) due.push({ el, top });
      });
      // Everything revealed in the same pass (typically the initial page load)
      // fans in top-to-bottom: sort by vertical position and hand each element
      // an increasing delay via --reveal-delay (read by .reveal/.cascade CSS).
      // Scroll-triggered reveals usually arrive one at a time and get 0ms.
      due.sort((a, b) => a.top - b.top);
      due.forEach(({ el }, i) => {
        el.style.setProperty("--reveal-delay", `${Math.min(i, 8) * 110}ms`);
        el.classList.add("is-visible");
      });
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      setTimeout(() => {
        ticking = false;
        reveal();
      }, 50);
    };

    reveal(); // initial above-the-fold pass
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // Re-check immediately when content mounts (async loads) or the route
    // changes. Only childList is observed, so our own class toggles (attribute
    // changes) don't retrigger it.
    const mo = new MutationObserver(reveal);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mo.disconnect();
    };
  }, []);
}
