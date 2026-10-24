/** Команды бота. Приложение регистрирует обработчик, ядро только рассылает. */

const commands = new Map();

export function registerCommand(name, handler) {
  const key = String(name || '').replace(/^\//, '').toLowerCase();
  if (!key || typeof handler !== 'function') return;
  commands.set(key, handler);
}

export function commandHandler(name) {
  return commands.get(String(name || '').toLowerCase()) || null;
}

export function commandNames() {
  return [...commands.keys()];
}
