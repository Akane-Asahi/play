// solver.js is a UMD script for the browser; load it here without the module system.
import { readFileSync } from 'node:fs';
export function loadSolver() {
  const src = readFileSync(new URL('../clue/solver.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('module', src)(module);
  return module.exports;
}
