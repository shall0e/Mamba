(() => {
  const entries = new Map();
  let frame = 0,
    nextId = 0;
  const selector = '.page,.source-errors,textarea';
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  const resize = new ResizeObserver(schedule);
  function discover() {
    for (const element of document.querySelectorAll(selector)) {
      if (entries.has(element)) continue;
      const track = document.createElement('div');
      track.className = 'ui-scrollbar';
      track.hidden = true;
      track.tabIndex = 0;
      track.setAttribute('role', 'scrollbar');
      track.setAttribute('aria-orientation', 'vertical');
      track.setAttribute('aria-valuemin', '0');
      if (!element.id) element.id = 'scroll-area-' + ++nextId;
      track.setAttribute('aria-controls', element.id);
      track.setAttribute(
        'aria-label',
        (element.getAttribute('aria-label') ||
          element.querySelector('h1,h2')?.textContent ||
          'Content') + ' scroll',
      );
      const thumb = document.createElement('div');
      thumb.className = 'ui-scrollbar-thumb';
      track.append(thumb);
      document.body.append(track);
      const entry = { element, track, thumb, travel: 0, max: 0, drag: null };
      entries.set(element, entry);
      resize.observe(element);
      track.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        track.focus({ preventScroll: true });
        track.setPointerCapture(event.pointerId);
        const rect = track.getBoundingClientRect();
        const thumbRect = thumb.getBoundingClientRect();
        const offset =
          event.target === thumb ? event.clientY - thumbRect.top : thumbRect.height / 2;
        entry.drag = { offset, top: rect.top };
        track.classList.add('dragging');
        move(event);
      });
      function move(event) {
        if (!entry.drag || !entry.travel) return;
        element.scrollTop = Math.max(
          0,
          Math.min(
            entry.max,
            ((event.clientY - entry.drag.top - entry.drag.offset) / entry.travel) * entry.max,
          ),
        );
        schedule();
      }
      track.addEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
        track.addEventListener(name, () => {
          entry.drag = null;
          track.classList.remove('dragging');
        });
      track.addEventListener('keydown', (event) => {
        let value = element.scrollTop;
        switch (event.key) {
          case 'ArrowDown':
            value += 40;
            break;
          case 'ArrowUp':
            value -= 40;
            break;
          case 'PageDown':
            value += element.clientHeight * 0.9;
            break;
          case 'PageUp':
            value -= element.clientHeight * 0.9;
            break;
          case 'Home':
            value = 0;
            break;
          case 'End':
            value = entry.max;
            break;
          default:
            return;
        }
        event.preventDefault();
        element.scrollTop = value;
      });
      track.addEventListener(
        'wheel',
        (event) => {
          element.scrollTop +=
            event.deltaY *
            (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
          event.preventDefault();
        },
        { passive: false },
      );
    }
    schedule();
  }
  function render() {
    frame = 0;
    for (const [element, entry] of entries) {
      if (!element.isConnected) {
        resize.unobserve(element);
        entry.track.remove();
        entries.delete(element);
        continue;
      }
      const rect = element.getBoundingClientRect();
      const max = element.scrollHeight - element.clientHeight;
      let top = Math.max(0, rect.top),
        bottom = Math.min(innerHeight, rect.bottom),
        right = Math.min(innerWidth, rect.right);
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          const clip = parent.getBoundingClientRect();
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
          right = Math.min(right, clip.right);
        }
      }
      const height = bottom - top - 16;
      const visible = element.getClientRects().length && max > 1 && height > 24 && right > 0;
      entry.track.hidden = !visible;
      if (!visible) continue;
      const thumbHeight = Math.min(
        height,
        Math.max(28, (height * element.clientHeight) / element.scrollHeight),
      );
      entry.max = max;
      entry.travel = height - thumbHeight;
      Object.assign(entry.track.style, {
        top: top + 8 + 'px',
        left: right - 13 + 'px',
        height: height + 'px',
      });
      Object.assign(entry.thumb.style, {
        height: thumbHeight + 'px',
        transform:
          'translateY(' + entry.travel * Math.min(1, Math.max(0, element.scrollTop / max)) + 'px)',
      });
      entry.track.style.setProperty(
        '--scrollbar-ink',
        getComputedStyle(element).getPropertyValue('--icon-ink').trim() ||
          getComputedStyle(document.documentElement).getPropertyValue('--color-icons').trim() ||
          '#ffffff',
      );
      entry.track.setAttribute('aria-valuemax', String(Math.round(max)));
      entry.track.setAttribute('aria-valuenow', String(Math.round(element.scrollTop)));
    }
  }
  new MutationObserver((records) => {
    if (records.some((record) => !record.target.closest?.('.ui-scrollbar'))) {
      if (records.some((record) => record.type === 'childList')) discover();
      else schedule();
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'class'],
  });
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  document.fonts.ready.then(schedule);
  discover();
})();
