/* ==========================================================================
   ui/tooltip.js
   --------------------------------------------------------------------------
   One floating tooltip, shared by every control that carries data-tip.

   Why this is JavaScript and not a CSS ::after: the ribbon scrolls
   horizontally, and any element that scrolls also clips. A CSS tooltip drawn
   inside the ribbon gets cut off by the pane below it, and a tooltip near the
   window edge runs off the screen entirely. Both were happening.

   A single element parked on <body> with fixed positioning has neither
   problem, and it can be nudged back inside the viewport when it would
   otherwise overflow.
   ========================================================================== */

let bubble = null;
let hideTimer = null;

function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'tooltip';
  bubble.setAttribute('role', 'tooltip');
  document.body.appendChild(bubble);
  return bubble;
}

function show(target) {
  const text = target.dataset.tip;
  if (!text) return;

  const el = ensureBubble();
  el.textContent = text;
  el.classList.add('is-visible');

  // Measure first, then place: the width depends on the text.
  const anchor = target.getBoundingClientRect();
  const size = el.getBoundingClientRect();
  const margin = 8;

  let left = anchor.left + anchor.width / 2 - size.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - size.width - margin));

  let top = anchor.bottom + 7;
  // Flip above the control if there is no room underneath.
  if (top + size.height > window.innerHeight - margin) top = anchor.top - size.height - 7;

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function hide() {
  if (bubble) bubble.classList.remove('is-visible');
}

/**
 * Starts listening. Any element with a data-tip attribute gets a tooltip,
 * including ones added to the page later.
 */
export function initTooltips() {
  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest('[data-tip]');
    if (!target) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => show(target), 320);
  });

  document.addEventListener('mouseout', (event) => {
    if (!event.target.closest('[data-tip]')) return;
    clearTimeout(hideTimer);
    hide();
  });

  // Keyboard users get the tooltip immediately, with no hover delay.
  document.addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tip]');
    if (target) show(target);
  });
  document.addEventListener('focusout', hide);

  // A tooltip anchored to something that just moved is worse than none.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('mousedown', hide);
}
