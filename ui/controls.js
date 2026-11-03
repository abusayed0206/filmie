// Shared controls: drawers, dialogs, menus and switches. Interpolated data must go through esc().

// A native <dialog> traps focus, closes on Escape and returns focus when it closes.
function openDialog(className, html, onClose) {
  const d = document.createElement('dialog');
  d.className = className;
  d.innerHTML = html;
  const below = [...document.querySelectorAll('dialog.drawer[open]')].at(-1);
  // The dialog itself only receives a click when it lands on the backdrop, because its content fills it.
  d.addEventListener('click', ev => { if (ev.target === d) d.close(); });
  d.addEventListener('close', () => {
    below?.classList.remove('under');
    onClose?.();
    setTimeout(() => d.remove(), 200); // lets the closing animation finish
  });
  document.body.append(d);
  d.showModal();
  below?.classList.add('under');
  return d;
}

// Slides in from the right. Stacked drawers scale the one below. Returns the dialog; `.drawer-body` holds the content.
function drawer({ title, width = 440, body = '', onClose }) {
  const d = openDialog('drawer', `<div class="drawer-head"><h2>${esc(title)}</h2>
    <button type="button" class="icon-btn ghost" data-close aria-label="Close">${icon('close')}</button></div>
    <div class="drawer-body">${body}</div>`, onClose);
  d.style.setProperty('--drawer-width', `${width}px`);
  d.querySelector('[data-close]').onclick = () => d.close();
  return d;
}

// actions: [{ label, primary, onClick }]. Any action closes the dialog after it runs.
function modal({ title, body = '', actions = [], onClose }) {
  const d = openDialog('modal', `<h2>${esc(title)}</h2><div class="modal-body">${body}</div>
    <div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn${a.primary ? ' primary' : ''}" data-action="${i}">${esc(a.label)}</button>`).join('')}</div>`, onClose);
  d.querySelector('.modal-actions').onclick = ev => {
    const button = ev.target.closest('[data-action]');
    if (!button) return;
    actions[+button.dataset.action].onClick?.();
    d.close();
  };
  return d;
}

// Pop-up menu for a button. items: [{ label, icon, danger, onClick }]. The popover API handles Escape and clicks outside.
function menu(button, items) {
  const m = document.createElement('div');
  m.className = 'menu';
  m.popover = 'auto';
  m.setAttribute('role', 'menu');
  m.innerHTML = items.map((x, i) => `<button type="button" role="menuitem" data-item="${i}"${x.danger ? ' class="danger"' : ''}>${x.icon ? icon(x.icon) : ''}${esc(x.label)}</button>`).join('');
  document.body.append(m);
  button.setAttribute('aria-haspopup', 'menu');
  button.popoverTargetElement = m;
  m.addEventListener('toggle', ev => {
    button.setAttribute('aria-expanded', String(ev.newState === 'open'));
    if (ev.newState !== 'open') return;
    // Opens under the button, and flips to stay inside the window.
    const b = button.getBoundingClientRect();
    const fitsBelow = b.bottom + m.offsetHeight + 6 <= innerHeight;
    m.style.top = `${fitsBelow ? b.bottom + 6 : Math.max(6, b.top - m.offsetHeight - 6)}px`;
    m.style.left = `${Math.max(6, Math.min(b.left, innerWidth - m.offsetWidth - 6))}px`;
    m.querySelector('button')?.focus();
  });
  m.addEventListener('click', ev => {
    const item = ev.target.closest('[data-item]');
    if (!item) return;
    m.hidePopover();
    items[+item.dataset.item].onClick?.();
  });
  m.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...m.querySelectorAll('button')];
    all[(all.indexOf(document.activeElement) + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
  });
  return m;
}

// options: [{ value, label, icon }]. Returns HTML; radio inputs give it arrow keys and a name for screen readers.
const segmentedChanges = new Map();
function segmented(name, options, value, onChange, label = name) {
  segmentedChanges.set(name, onChange);
  return `<div class="segmented" role="radiogroup" aria-label="${esc(label)}" style="--n:${options.length}">${options.map(o => `<label>
    <input type="radio" name="${esc(name)}" value="${esc(o.value)}"${o.value === value ? ' checked' : ''}>${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span></label>`).join('')}</div>`;
}
document.addEventListener('change', ev => {
  if (ev.target.closest('.segmented')) segmentedChanges.get(ev.target.name)?.(ev.target.value);
});
