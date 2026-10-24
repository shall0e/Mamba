(() => {
  const queue = [];
  let active = false;
  function next() {
    if (active || !queue.length) return;
    active = true;
    const data = queue.shift();
    const previous = document.activeElement;
    const popup = document.createElement('dialog');
    popup.className = 'mamba-dialog';
    const heading = document.createElement('h2');
    heading.id = 'mamba-dialog-title';
    heading.textContent = data.title;
    popup.setAttribute('aria-labelledby', heading.id);
    const symbol = icon(data.type === 'warning' || data.type === 'error' ? 'circle-alert' : 'info');
    const header = document.createElement('div');
    header.className = 'mamba-dialog-heading';
    header.append(symbol, heading);
    const message = document.createElement('p');
    message.className = 'mamba-dialog-message';
    message.textContent = data.message;
    const detail = document.createElement('p');
    detail.className = 'mamba-dialog-detail';
    detail.id = 'mamba-dialog-detail';
    detail.textContent = data.detail;
    popup.setAttribute('aria-describedby', detail.id);
    const actions = document.createElement('div');
    actions.className = 'mamba-dialog-actions';
    let finished = false;
    const finish = async (response) => {
      if (finished) return;
      finished = true;
      popup.close();
      popup.remove();
      try {
        await window.mamba.respondDialog(data.id, response);
      } finally {
        active = false;
        previous?.focus();
        next();
      }
    };
    data.buttons.forEach((label, index) => {
      const control = button(
        label,
        () => finish(index),
        null,
        index === data.cancelId ? 'text-button' : 'secondary-button',
      );
      actions.append(control);
    });
    popup.append(header, message, detail, actions);
    popup.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(data.cancelId);
    });
    document.body.append(popup);
    popup.showModal();
    actions.children[data.defaultId]?.focus();
  }
  window.mamba.onDialog((data) => {
    queue.push(data);
    next();
  });
})();
