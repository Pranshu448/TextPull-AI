const sessions = new Map();

export function saveSession(sessionId, data) {
  sessions.set(sessionId, { ...data, updatedAt: Date.now() });
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

export function appendChatTurn(sessionId, role, content) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const history = session.history || [];
  history.push({ role, content });
  session.history = history.slice(-8);
  session.updatedAt = Date.now();
  sessions.set(sessionId, session);
}
