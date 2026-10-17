const STATUSES = new Set(['Queued', 'In review', 'Ready']);

export const BASE_TASKS = Object.freeze([
  Object.freeze({ id: 'T-101', title: 'Review project brief', status: 'In review', version: 3 }),
  Object.freeze({ id: 'T-102', title: 'Prepare outline', status: 'Ready', version: 2 }),
  Object.freeze({ id: 'T-103', title: 'Schedule handoff', status: 'Queued', version: 1 }),
]);

export const SCENARIOS = Object.freeze({
  duplicate: {
    title: 'One event. Delivered twice.',
    explanation: 'A retry delivers the same new task twice. An event ID lets the interface recognize the replay.',
    events: [
      { id: 'E-104', type: 'create', task: { id: 'T-104', title: 'Check final details', status: 'Queued', version: 1 } },
      { id: 'E-104', type: 'create', task: { id: 'T-104', title: 'Check final details', status: 'Queued', version: 1 } },
    ],
    safeResult: 'The replay was ignored. One task was added, once.',
    unsafeResult: 'The replay created a second copy of the same task.',
  },
  stale: {
    title: 'The older update arrives last.',
    explanation: 'Network timing reverses two updates. Entity versions keep an older message from replacing newer state.',
    events: [
      { id: 'E-105', type: 'update', task: { id: 'T-101', title: 'Review project brief', status: 'Ready', version: 4 } },
      { id: 'E-103', type: 'update', task: { id: 'T-101', title: 'Review project brief', status: 'In review', version: 3 } },
    ],
    safeResult: 'Version 3 was ignored. The brief stays Ready at version 4.',
    unsafeResult: 'The late message moved the brief back to In review.',
  },
  reconnect: {
    title: 'Reconnect is only the beginning.',
    explanation: 'A task arrives while the connection is down. Reconciliation restores the missed work from a fresh snapshot.',
    events: [
      { id: 'offline', type: 'disconnect' },
      { id: 'E-104', type: 'missed', task: { id: 'T-104', title: 'Check final details', status: 'Queued', version: 1 } },
      { id: 'snapshot', type: 'reconnect' },
    ],
    safeResult: 'Connection restored and the missed task recovered.',
    unsafeResult: 'Connected again, but the missed task is still missing.',
  },
});

export function createQueue() {
  return { tasks: BASE_TASKS.map(task => ({ ...task })), seen: [], connected: true };
}

function validTask(task) {
  return task && typeof task.id === 'string' && task.id.length > 0
    && typeof task.title === 'string' && STATUSES.has(task.status)
    && Number.isSafeInteger(task.version) && task.version > 0;
}

export function applyEvent(state, event, guarded = true) {
  if (!event || typeof event.id !== 'string' || !['create', 'update'].includes(event.type) || !validTask(event.task)) {
    return { state, outcome: 'invalid' };
  }
  if (!state.connected) return { state, outcome: 'offline' };
  if (guarded && state.seen.includes(event.id)) return { state, outcome: 'duplicate' };
  const index = state.tasks.findIndex(task => task.id === event.task.id);
  if (guarded && index !== -1 && state.tasks[index].version >= event.task.version) {
    return { state: { ...state, seen: [...state.seen, event.id] }, outcome: 'stale' };
  }
  const tasks = state.tasks.map(task => ({ ...task }));
  if (index === -1 || (!guarded && event.type === 'create')) tasks.push({ ...event.task });
  else tasks[index] = { ...event.task };
  return { state: { ...state, tasks, seen: [...state.seen, event.id] }, outcome: 'applied' };
}

export function reconcileSnapshot(state, snapshot) {
  const tasks = state.tasks.map(task => ({ ...task }));
  for (const incoming of snapshot) {
    if (!validTask(incoming)) continue;
    const index = tasks.findIndex(task => task.id === incoming.id);
    if (index === -1) tasks.push({ ...incoming });
    else if (incoming.version > tasks[index].version) tasks[index] = { ...incoming };
  }
  return { ...state, tasks, connected: true };
}

export function createDraft() {
  return { title: 'Quarterly supplier review', revision: 0, pending: null, suggestion: null, phase: 'editing' };
}

export function draftTransition(state, action) {
  switch (action.type) {
    case 'edit':
      if (state.phase === 'confirmed') return state;
      return { ...state, title: action.title, revision: state.revision + 1, phase: 'editing' };
    case 'request':
      if (state.phase === 'confirmed') return state;
      return { ...state, pending: { id: action.id, revision: state.revision }, suggestion: null, phase: 'editing' };
    case 'resolve':
      if (!state.pending || state.pending.id !== action.id || typeof action.title !== 'string') return state;
      return state.pending.revision === state.revision
        ? { ...state, title: action.title, revision: state.revision + 1, pending: null }
        : { ...state, suggestion: action.title, pending: null };
    case 'accept':
      if (state.suggestion === null) return state;
      return { ...state, title: state.suggestion, suggestion: null, revision: state.revision + 1, phase: 'editing' };
    case 'keep':
      return { ...state, suggestion: null };
    case 'review':
      if (state.pending || state.suggestion !== null || !state.title.trim() || state.phase !== 'editing') return state;
      return { ...state, phase: 'review' };
    case 'back':
      return state.phase === 'review' ? { ...state, phase: 'editing' } : state;
    case 'confirm':
      return state.phase === 'review' ? { ...state, phase: 'confirmed' } : state;
    default:
      return state;
  }
}
