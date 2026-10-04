import { solveSchedule } from './model/solver.js';

self.onmessage = event => {
  try {
    const result = solveSchedule(event.data, {
      onProgress: progress => self.postMessage({ type: 'progress', progress })
    });
    self.postMessage({ type: 'result', ok: true, result });
  } catch (error) {
    self.postMessage({ type: 'result', ok: false, error: error?.message || String(error) });
  }
};
