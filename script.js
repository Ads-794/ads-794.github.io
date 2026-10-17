import { BASE_TASKS, SCENARIOS, createQueue, applyEvent, reconcileSnapshot, createDraft, draftTransition } from './lab-engine.js';

const find = selector => document.querySelector(selector);
document.documentElement.classList.add('js');
find('#year').textContent = String(new Date().getFullYear());

// Navigation stays native; JavaScript adds an optional mobile disclosure.
const menuButton = find('.menu-button');
const navLinks = find('#nav-links');
function closeMenu(restoreFocus = false) {
  navLinks.classList.remove('is-open');
  menuButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menuButton.focus();
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  navLinks.classList.toggle('is-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
});
navLinks.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeMenu()));
window.matchMedia('(max-width: 900px)').addEventListener('change', () => closeMenu());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') closeMenu(true);
});

// All queue data is synthetic. Each run begins from the same small fixture.
const experiment = find('#reliability-lab');
const scenarioButtons = [...document.querySelectorAll('[data-scenario]')];
const guard = find('#guard-toggle');
const runButton = find('#run-queue');
const resetButton = find('#queue-reset');
const queueRows = find('#queue-rows');
const eventLog = find('#event-log');
const queueResult = find('#queue-result');
let scenarioKey = 'duplicate';
let queue = createQueue();
let queueTimers = [];
let running = false;

function cell(text, className = '') {
  const element = document.createElement('span');
  element.setAttribute('role', 'cell');
  element.className = className;
  element.textContent = text;
  return element;
}
function renderQueue(changedId) {
  const ids = new Set();
  const rows = queue.tasks.map(task => {
    const row = document.createElement('div');
    row.className = 'queue-row';
    row.setAttribute('role', 'row');
    if (task.id === changedId) row.classList.add('changed');
    if (ids.has(task.id)) row.classList.add('duplicate');
    ids.add(task.id);
    const statusCell = cell('');
    const status = document.createElement('span');
    status.className = 'task-status ' + ({ 'In review': 'review', Ready: 'ready', Queued: 'queued' }[task.status]);
    status.textContent = task.status;
    statusCell.append(status);
    row.append(cell(task.title), statusCell, cell('v' + task.version, 'version'));
    return row;
  });
  queueRows.replaceChildren(...rows);
  const connection = find('#connection-state');
  const dot = document.createElement('span');
  connection.replaceChildren(dot, document.createTextNode(queue.connected ? 'Connected' : 'Disconnected'));
  connection.classList.toggle('offline', !queue.connected);
}
function logEvent(message, code, warning = false) {
  const entry = document.createElement('p');
  const marker = document.createElement('span');
  marker.className = 'log-marker';
  const description = document.createElement('span');
  description.textContent = message;
  const label = document.createElement('code');
  label.textContent = code;
  entry.append(marker, description, label);
  if (warning) entry.classList.add('warn');
  eventLog.append(entry);
}
function setRunning(value) {
  running = value;
  experiment.classList.toggle('is-running', value);
  runButton.disabled = value;
  runButton.querySelector('span').textContent = value ? 'Running…' : 'Run experiment';
  guard.disabled = value;
  scenarioButtons.forEach(button => { button.disabled = value; });
}
function resetQueue() {
  queueTimers.forEach(timer => clearTimeout(timer));
  queueTimers = [];
  setRunning(false);
  queue = createQueue();
  renderQueue();
  eventLog.replaceChildren();
  logEvent('Ready to receive an event.', 'waiting');
  queueResult.textContent = SCENARIOS[scenarioKey].explanation;
  delete queueResult.dataset.state;
}
scenarioButtons.forEach(button => {
  button.disabled = false;
  button.addEventListener('click', () => {
    scenarioKey = button.dataset.scenario;
    scenarioButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    resetQueue();
  });
});
guard.disabled = false;
guard.addEventListener('change', () => {
  find('#guard-word').textContent = guard.checked ? 'on' : 'off';
  resetQueue();
});
resetButton.disabled = false;
resetButton.addEventListener('click', resetQueue);
runButton.disabled = false;
runButton.addEventListener('click', () => {
  if (running) return;
  resetQueue();
  const scenario = SCENARIOS[scenarioKey];
  const guarded = guard.checked;
  setRunning(true);
  queueResult.textContent = scenario.title;
  eventLog.replaceChildren();
  scenario.events.forEach((event, index) => {
    queueTimers.push(setTimeout(() => {
      if (event.type === 'disconnect') {
        queue = { ...queue, connected: false };
        logEvent('Connection lost.', 'offline', true);
      } else if (event.type === 'missed') {
        logEvent('New task arrived while offline.', 'missed', true);
      } else if (event.type === 'reconnect') {
        const snapshot = [...BASE_TASKS, scenario.events.find(item => item.type === 'missed').task];
        queue = guarded ? reconcileSnapshot(queue, snapshot) : { ...queue, connected: true };
        logEvent(guarded ? 'Snapshot recovered the task.' : 'Connected; no reconciliation.', guarded ? 'recovered' : 'gap', !guarded);
      } else {
        const result = applyEvent(queue, event, guarded);
        queue = result.state;
        const description = {
          duplicate: 'Repeated event ignored.',
          stale: 'Older version ignored.',
          applied: event.type === 'create' ? 'New task added.' : 'Task updated to v' + event.task.version + '.',
        }[result.outcome];
        logEvent(description || 'Event rejected.', event.id, !guarded && index > 0);
      }
      renderQueue(event.task?.id);
      if (index === scenario.events.length - 1) {
        setRunning(false);
        queueResult.textContent = guarded ? scenario.safeResult : scenario.unsafeResult;
        queueResult.dataset.state = guarded ? 'safe' : 'unsafe';
      }
    }, 450 + index * 1000));
  });
});

// Request IDs reject abandoned responses; revisions preserve concurrent user edits.
let draft = createDraft();
let nextRequestId = 0;
let draftTimer;
const titleInput = find('#draft-title-input');
const requestButton = find('#request-suggestion');
const reviewButton = find('#review-draft');
const draftStatus = find('#draft-status');

function renderDraft(message) {
  titleInput.value = draft.title;
  titleInput.disabled = false;
  requestButton.disabled = !!draft.pending;
  requestButton.textContent = draft.pending ? 'Suggestion arriving…' : 'Request suggestion';
  reviewButton.disabled = !!draft.pending || draft.suggestion !== null || !draft.title.trim();
  titleInput.setAttribute('aria-invalid', String(!draft.title.trim()));
  find('#draft-editor').hidden = draft.phase !== 'editing';
  find('#draft-review').hidden = draft.phase !== 'review';
  find('#draft-confirmed').hidden = draft.phase !== 'confirmed';
  find('#draft-suggestion').hidden = draft.suggestion === null;
  find('#suggested-title').textContent = draft.suggestion ?? '';
  find('#review-title').textContent = draft.title;
  find('#confirmed-title').textContent = draft.title;
  document.querySelectorAll('[data-draft-step]').forEach(step => {
    if (step.dataset.draftStep === draft.phase) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
  let status = message ?? 'Ready for your input.';
  let state = 'ready';
  if (draft.pending) {
    status = 'Suggestion arriving in a moment. Try editing the title now.';
    state = 'pending';
  } else if (!draft.title.trim()) {
    status = 'Add a title before reviewing your draft.';
    state = 'invalid';
  } else if (draft.suggestion !== null) {
    status = 'Your title changed during the request. Choose which version to keep.';
    state = 'conflict';
  }
  draftStatus.textContent = status;
  draftStatus.dataset.state = state;
}
titleInput.setAttribute('aria-describedby', 'draft-status');
titleInput.addEventListener('input', () => {
  draft = draftTransition(draft, { type: 'edit', title: titleInput.value });
  // Preserve the caret when editing in the middle of a title.
  const selection = [titleInput.selectionStart, titleInput.selectionEnd];
  renderDraft('Your edit is saved in this demo.');
  titleInput.setSelectionRange(...selection);
});
requestButton.addEventListener('click', () => {
  const id = ++nextRequestId;
  clearTimeout(draftTimer);
  draft = draftTransition(draft, { type: 'request', id });
  renderDraft();
  draftTimer = setTimeout(() => {
    draft = draftTransition(draft, { type: 'resolve', id, title: 'Quarterly supplier review — decisions and next steps' });
    renderDraft('Suggestion added. Edit it freely before reviewing.');
  }, 2800);
});
find('#keep-edit').addEventListener('click', () => {
  draft = draftTransition(draft, { type: 'keep' });
  renderDraft('Your version is kept. Review it when you are ready.');
  titleInput.focus();
});
find('#accept-suggestion').addEventListener('click', () => {
  draft = draftTransition(draft, { type: 'accept' });
  renderDraft('Suggestion accepted. You can still edit it.');
  titleInput.focus();
});
reviewButton.addEventListener('click', () => {
  draft = draftTransition(draft, { type: 'review' });
  renderDraft();
  if (draft.phase === 'review') find('#edit-again').focus();
});
find('#edit-again').addEventListener('click', () => {
  draft = draftTransition(draft, { type: 'back' });
  renderDraft();
  titleInput.focus();
});
find('#confirm-draft').addEventListener('click', () => {
  draft = draftTransition(draft, { type: 'confirm' });
  renderDraft();
  if (draft.phase === 'confirmed') find('#draft-confirmed').focus();
});
find('#reset-draft').disabled = false;
find('#reset-draft').addEventListener('click', () => {
  clearTimeout(draftTimer);
  draft = createDraft();
  renderDraft('Demo reset. Ready for your input.');
  titleInput.focus();
});
renderDraft();

// Native dialog provides focus containment and Escape handling.
const dialog = find('#command-dialog');
const search = find('#command-search');
const commands = [...dialog.querySelectorAll('[data-command]')];
const commandTrigger = find('.command-trigger');
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function filterCommands() {
  const query = normalize(search.value.trim());
  commands.forEach(command => { command.hidden = !normalize(command.textContent).includes(query); });
  find('#command-empty').hidden = commands.some(command => !command.hidden);
}
function openCommands() {
  if (dialog.open) return;
  closeMenu();
  search.value = '';
  filterCommands();
  dialog.showModal();
  search.focus();
}
commandTrigger.addEventListener('click', openCommands);
find('#close-command').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
search.addEventListener('input', filterCommands);
commands.forEach(command => command.addEventListener('click', event => {
  const href = command.getAttribute('href');
  if (href.startsWith('#')) {
    event.preventDefault();
    const destination = document.getElementById(href.slice(1));
    dialog.close();
    destination.setAttribute('tabindex', '-1');
    window.location.hash = href;
    destination.focus({ preventScroll: true });
    return;
  }
  dialog.close();
}));
dialog.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    const focusable = [...dialog.querySelectorAll('button, input, a[href]')]
      .filter(element => !element.disabled && !element.hidden && element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }
  const visible = commands.filter(command => !command.hidden);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!visible.length) return;
    const current = visible.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (current + 1) % visible.length : (current <= 0 ? visible.length - 1 : current - 1);
    visible[next].focus();
  } else if (event.key === 'Enter' && document.activeElement === search && visible.length) {
    event.preventDefault();
    visible[0].click();
  }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (dialog.open) dialog.close();
    else openCommands();
  }
});
if (/Mac|iPhone|iPad/.test(navigator.platform)) commandTrigger.querySelector('kbd').textContent = '⌘ K';

find('#copy-email').addEventListener('click', async () => {
  const status = find('#copy-status');
  try {
    await navigator.clipboard.writeText('aadityaadixit@gmail.com');
    status.textContent = 'Email address copied.';
  } catch {
    status.textContent = 'Copy is unavailable here. Select the address, or use the email link.';
  }
});
