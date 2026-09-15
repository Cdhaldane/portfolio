/*
 * A tiny registry so route transitions can reset scroll through whichever
 * scroller is actually in charge. When Lenis is mounted it owns the scroll
 * position, and calling window.scrollTo behind its back leaves its internal
 * target out of sync — the next wheel event snaps back to where it thought
 * it was (CLAUDE.md §5: scroll-linked effects read one source of truth).
 */
let lenis = null;

export const setLenis = (instance) => {
  lenis = instance;
};

/** Jump to the top of the document, immediately and without animation. */
export const scrollToTop = () => {
  if (lenis) {
    lenis.scrollTo(0, { immediate: true });
    return;
  }
  window.scrollTo(0, 0);
};
