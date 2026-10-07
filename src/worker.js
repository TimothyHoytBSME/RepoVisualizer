import { analyze } from './analyze.js';

self.onmessage = e => {
  const { files, name } = e.data;
  try {
    const graph = analyze(files, name, p => self.postMessage({ progress: p }));
    const { s, t, type } = graph.edges;
    self.postMessage({ graph }, [s.buffer, t.buffer, type.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err && err.stack) || err) });
  }
};
