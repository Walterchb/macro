// The header travels one pixel per scrolled pixel, without a toggle animation.
export function initMobileTopbar(topbar) {
  const root = document.documentElement;
  const mobile = window.matchMedia("(max-width: 760px)");
  let lastY = Math.max(0, window.scrollY),
    offset = 0,
    frame = 0;
  const paint = () => root.style.setProperty("--topbar-offset", `${offset}px`);
  const reveal = () => {
    offset = 0;
    paint();
  };
  const update = () => {
    frame = 0;
    // Locking a modal temporarily fixes the body; ignore the resulting scroll events.
    if (root.classList.contains("chart-export-open")) return;
    const y = Math.max(
      0,
      Math.min(
        window.scrollY,
        Math.max(0, root.scrollHeight - window.innerHeight),
      ),
    );
    const delta = y - lastY;
    lastY = y;
    if (
      !mobile.matches ||
      (topbar.contains(document.activeElement) &&
        document.activeElement.matches(":focus-visible"))
    ) {
      reveal();
      return;
    }
    offset = Math.max(0, Math.min(topbar.offsetHeight, y, offset + delta));
    paint();
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    if (root.classList.contains("chart-export-open")) return;
    if (!mobile.matches) reveal();
    else {
      offset = Math.min(offset, topbar.offsetHeight);
      paint();
    }
  });
  window.addEventListener("sbs:scroll-restored", () => {
    lastY = Math.max(0, window.scrollY);
  });
  topbar.addEventListener("focusin", reveal);
  paint();
}
