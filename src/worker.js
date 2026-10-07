import { analyze } from './analyze.js';

self.onmessage = e => {
  const { files, name } = e.data;
  try {
    const graph = analyze(files, name, p => self.postMessage({ progress: p }));
    self.postMessage({ graph });
  } catch (err) {
    self.postMessage({ error: String((err && err.stack) || err) });
  }
};
