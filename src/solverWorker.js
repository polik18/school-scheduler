import { solveSchedule } from './model/solver.js';

self.onmessage = event => {
  try {
    self.postMessage({ ok: true, result: solveSchedule(event.data) });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || String(error) });
  }
};
