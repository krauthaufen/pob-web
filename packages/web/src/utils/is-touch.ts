/**
 * Detect touch-primary devices to suppress hover tooltips.
 * Listens for the first touchstart and sets a flag.
 * Also re-enables hover if a mouse move is detected later (e.g. docked tablets).
 */
let touchActive = false;

if (typeof window !== "undefined") {
  window.addEventListener("touchstart", () => { touchActive = true; }, { passive: true });
  window.addEventListener("mousemove", (e) => {
    // Real mouse moves have movementX/Y; synthetic ones from touch don't
    if (e.movementX || e.movementY) touchActive = false;
  }, { passive: true });
}

export function isTouchDevice(): boolean {
  return touchActive;
}
