// Progressive enhancement: native details and static artwork work without JS.
export function initializeMotion() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const settleDisclosures = [];

  if (typeof Element.prototype.animate === 'function') {
    document.querySelectorAll('details').forEach(details => {
      const summary = details.querySelector('summary');
      const content = summary.nextElementSibling;
      let expanded = details.open;
      let animation = null;

      function syncControl() {
        details.dataset.expanded = String(expanded);
        summary.setAttribute('aria-expanded', String(expanded));
      }

      function settle() {
        animation?.cancel();
        animation = null;
        details.open = expanded;
        details.style.removeProperty('height');
        details.style.removeProperty('overflow');
        content.inert = false;
        syncControl();
      }

      syncControl();
      settleDisclosures.push(settle);
      summary.addEventListener('click', event => {
        event.preventDefault();
        const startHeight = details.getBoundingClientRect().height;
        animation?.cancel();
        animation = null;
        expanded = !expanded;
        syncControl();
        if (!expanded && content.contains(document.activeElement)) summary.focus();
        if (reducedMotion.matches) {
          settle();
          return;
        }

        // Keep native content rendered during the exit; hide it only at the end.
        details.open = true;
        details.style.removeProperty('height');
        const styles = getComputedStyle(details);
        const closedHeight = summary.getBoundingClientRect().height
          + parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
        const endHeight = expanded ? details.getBoundingClientRect().height : closedHeight;
        details.style.overflow = 'hidden';
        content.inert = !expanded;
        animation = details.animate(
          { height: [startHeight + 'px', endHeight + 'px'] },
          { duration: expanded ? 360 : 260, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' }
        );
        animation.onfinish = settle;
      });

      // Keep native/programmatic toggles (including browser find) in sync.
      details.addEventListener('toggle', () => {
        if (animation) return;
        expanded = details.open;
        syncControl();
      });
    });
  }

  const artwork = [...document.querySelectorAll('.notebook-art')];
  const visible = new Set();
  let frame = 0;

  function renderArtwork() {
    frame = 0;
    if (reducedMotion.matches || document.hidden) return;
    // Batch layout reads before writes. Only visible sections receive updates.
    const positions = [...visible].map(art => ({ art, bounds: art.parentElement.getBoundingClientRect() }));
    positions.forEach(({ art, bounds }) => {
      const progress = Math.max(0, Math.min(1, (innerHeight - bounds.top) / (innerHeight + bounds.height)));
      art.style.setProperty('--trace-offset', (1 - progress).toFixed(4));
      art.style.setProperty('--trace-shift', ((progress - .5) * 56).toFixed(2) + 'px');
    });
  }

  function scheduleArtwork() {
    if (!frame && !reducedMotion.matches && !document.hidden && visible.size) {
      frame = requestAnimationFrame(renderArtwork);
    }
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      scheduleArtwork();
    });
    artwork.forEach(art => observer.observe(art));
    window.addEventListener('scroll', scheduleArtwork, { passive: true });
    document.addEventListener('toggle', scheduleArtwork, true);
  }

  window.addEventListener('resize', () => {
    settleDisclosures.forEach(settle => settle());
    scheduleArtwork();
  });
  reducedMotion.addEventListener('change', () => {
    settleDisclosures.forEach(settle => settle());
    cancelAnimationFrame(frame);
    frame = 0;
    artwork.forEach(art => {
      art.style.removeProperty('--trace-offset');
      art.style.removeProperty('--trace-shift');
    });
    scheduleArtwork();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      settleDisclosures.forEach(settle => settle());
      cancelAnimationFrame(frame);
      frame = 0;
    } else scheduleArtwork();
  });
}
