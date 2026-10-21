(() => {
  const $ = (selector) => document.querySelector(selector);
  const scan = $('#cleanup-scan'),
    remove = $('#cleanup-delete'),
    list = $('#cleanup-list');
  const status = $('#cleanup-status'),
    review = $('#cleanup-review'),
    all = $('#cleanup-select-all');
  const selected = new Set();
  let snapshot = null,
    busy = false;
  scan.prepend(icon('refresh-cw'));
  remove.prepend(icon('trash-2'));
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };

  function update() {
    const count = selected.size,
      total = snapshot?.items.length || 0;
    const bytes = (snapshot?.items || [])
      .filter((item) => selected.has(item.id))
      .reduce((sum, item) => sum + item.bytes, 0);
    $('#cleanup-selected').textContent = count + ' selected · ' + formatBytes(bytes);
    scan.disabled = busy;
    remove.disabled = busy || !count;
    all.disabled = busy || !total;
    all.checked = count > 0 && count === total;
    all.indeterminate = count > 0 && count < total;
    for (const input of list.querySelectorAll('input')) {
      input.disabled = busy;
      input.checked = selected.has(input.value);
    }
    scan.setAttribute('aria-busy', String(busy));
    remove.setAttribute('aria-busy', String(busy));
  }

  function draw() {
    list.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const item of snapshot?.items || []) {
      const row = node('label', undefined, 'cleanup-row');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.id;
      checkbox.setAttribute('aria-label', 'Select ' + item.relative);
      checkbox.onchange = () => {
        checkbox.checked ? selected.add(item.id) : selected.delete(item.id);
        update();
      };
      const info = node('span', undefined, 'cleanup-info');
      info.append(
        node('strong', item.name),
        node('small', item.kind + ' · ' + new Date(item.modified).toLocaleDateString()),
        node('small', item.relative, 'cleanup-path'),
      );
      row.title = item.path;
      row.append(checkbox, info, node('span', formatBytes(item.bytes), 'cleanup-size'));
      fragment.append(row);
    }
    list.append(fragment);
    review.hidden = !snapshot?.items.length;
    update();
  }

  scan.onclick = async () => {
    if (busy) return;
    busy = true;
    selected.clear();
    snapshot = null;
    draw();
    status.textContent = 'Scanning leftover files…';
    try {
      snapshot = await window.mamba.scanCleanup();
      const bytes = snapshot.items.reduce((sum, item) => sum + item.bytes, 0);
      status.textContent = snapshot.items.length
        ? snapshot.items.length + ' items · ' + formatBytes(bytes) + ' · ' + snapshot.root
        : 'No old leftover files found in ' + snapshot.root + '.';
      if (snapshot.skipped)
        status.textContent +=
          ' ' + snapshot.skipped + ' items could not be inspected and were left untouched.';
      if (snapshot.limited)
        status.textContent += ' Showing the first 250 items. Scan again after cleanup for more.';
    } catch (error) {
      status.textContent =
        'Scan failed. ' +
        String(error.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    } finally {
      busy = false;
      draw();
    }
  };

  all.onchange = () => {
    selected.clear();
    if (all.checked) for (const item of snapshot?.items || []) selected.add(item.id);
    update();
  };

  remove.onclick = async () => {
    if (busy || !snapshot || !selected.size) return;
    busy = true;
    update();
    status.textContent = 'Review the deletion confirmation…';
    try {
      const result = await window.mamba.removeCleanup(snapshot.id, [...selected]);
      if (!result) {
        status.textContent = 'Cleanup cancelled. No files deleted.';
        return;
      }
      snapshot.items = snapshot.items.filter((item) => !result.removed.includes(item.id));
      for (const id of result.removed) selected.delete(id);
      status.textContent =
        result.removed.length + ' items deleted · ' + formatBytes(result.bytes) + ' freed.';
      if (result.failures.length)
        status.textContent +=
          ' ' +
          result.failures.length +
          ' items were skipped. ' +
          result.failures.map((item) => item.name + ': ' + item.message).join(' ');
    } catch (error) {
      status.textContent =
        'Cleanup stopped. ' +
        String(error.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') +
        ' Scan again before retrying.';
    } finally {
      busy = false;
      draw();
    }
  };
  update();
})();
