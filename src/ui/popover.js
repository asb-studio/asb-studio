/* ==========================================================================
   ui/popover.js
   --------------------------------------------------------------------------
   Placing a dropdown so nothing can clip it.

   A menu list positioned inside its own bar is at the mercy of that bar: give
   the bar `overflow: hidden` or `overflow-x: auto` - both of which a toolbar
   needs - and the dropdown is cut off at the bar's edge. On a narrow screen
   that meant tapping a menu did nothing visible at all, and the toolbar's ⋮
   button opened a panel nobody could see.

   Fixed positioning takes the panel out of every ancestor's clipping box, and
   the coordinates are worked out from the button each time it opens. The panel
   stays inside the window, flipping above the button when there is no room
   below it.
   ========================================================================== */

const MARGIN = 8;

/**
 * Positions an open panel under its trigger.
 * @param {HTMLElement} panel
 * @param {HTMLElement} trigger
 * @param {'start'|'end'} align  which edge of the trigger to line up with
 */
export function place(panel, trigger, align = 'start') {
  panel.style.position = 'fixed';
  panel.style.top = '0px';
  panel.style.left = '0px';
  panel.style.insetInlineStart = 'auto';
  panel.style.insetInlineEnd = 'auto';
  panel.style.maxHeight = '';

  const anchor = trigger.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';

  /* --- horizontal --- */
  // In a right-to-left page the "start" edge is the right one.
  let left = align === 'start'
    ? (rtl ? anchor.right - box.width : anchor.left)
    : (rtl ? anchor.left : anchor.right - box.width);

  left = Math.max(MARGIN, Math.min(left, window.innerWidth - box.width - MARGIN));

  /* --- vertical --- */
  let top = anchor.bottom + 4;
  const below = window.innerHeight - anchor.bottom - MARGIN;
  const above = anchor.top - MARGIN;

  if (box.height > below && above > below) {
    // More room over the button than under it.
    top = Math.max(MARGIN, anchor.top - box.height - 4);
    panel.style.maxHeight = `${above - 4}px`;
  } else {
    panel.style.maxHeight = `${below - 4}px`;
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

/**
 * Keeps a panel in place while the window changes under it, and closes it
 * when something scrolls - a panel anchored to a button that has moved is
 * worse than no panel.
 */
export function follow(panel, trigger, onDismiss) {
  const reposition = () => place(panel, trigger, panel.dataset.align || 'start');

  const onScroll = (event) => {
    // Scrolling inside the panel itself is fine.
    if (panel.contains(event.target)) return;
    onDismiss();
  };

  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', onScroll, true);

  return () => {
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', onScroll, true);
  };
}


/* --------------------------------------------------------------------------
   Only one at a time

   Every popover closes on a document click, but the button that opens one
   calls stopPropagation so its own click does not immediately shut it again -
   which means opening a second popover never told the first to go. They ended
   up stacked, and on a narrow screen sitting on top of each other.

   So they announce themselves here instead, and opening one closes the last.
   -------------------------------------------------------------------------- */

let openPopover = null;

/**
 * @param {() => void} close  called when something else opens
 * @returns {() => void} call when this one closes on its own
 */
export function claim(close) {
  if (openPopover && openPopover !== close) openPopover();
  openPopover = close;

  return () => {
    if (openPopover === close) openPopover = null;
  };
}

/** Closes whatever is open. */
export function closeAllPopovers() {
  if (openPopover) {
    const close = openPopover;
    openPopover = null;
    close();
  }
}
