// 本機版本管理（LocalStorage）
const KEY = 'school-scheduler-versions';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveVersion(name, record) {
  const versions = readAll().filter(v => v.name !== name);
  versions.push({ ...record, savedAt: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(versions));
}

export function loadVersions() {
  return readAll();
}

export function deleteVersion(name) {
  localStorage.setItem(KEY, JSON.stringify(readAll().filter(v => v.name !== name)));
}
