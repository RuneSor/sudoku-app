/* Sudoku-motor: generering og løsning med bitmasker.
 * Eksponerer globalt objekt `Sudoku` med generate(difficulty) og solve(grid, limit).
 * Brett representeres som array med 81 tall (0 = tom rute).
 */
const Sudoku = (() => {
  'use strict';

  const ROW = [], COL = [], BOX = [];
  for (let i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
  }
  const ALL = 0x3fe; // bit 1..9

  function popcount(x) {
    let c = 0;
    while (x) { x &= x - 1; c++; }
    return c;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Teller løsninger (opp til `limit`) og returnerer første løsning.
   * randomize = true gir tilfeldig sifferrekkefølge (brukes for å lage fulle brett).
   */
  function solve(grid, limit = 2, randomize = false) {
    const g = grid.slice();
    const rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    for (let i = 0; i < 81; i++) {
      const d = g[i];
      if (!d) continue;
      const b = 1 << d;
      if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return { count: 0, solution: null };
      rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
    }

    let count = 0, solution = null;

    const rec = () => {
      // Velg ruten med færrest kandidater (MRV)
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
        const n = popcount(m);
        if (n < bestN) {
          bestN = n; best = i; bestMask = m;
          if (n <= 1) break;
        }
      }
      if (best < 0) {
        count++;
        if (!solution) solution = g.slice();
        return;
      }
      if (bestN === 0) return;

      const digits = [];
      for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
      if (randomize) shuffle(digits);

      const r = ROW[best], c = COL[best], bx = BOX[best];
      for (const d of digits) {
        const b = 1 << d;
        g[best] = d;
        rows[r] |= b; cols[c] |= b; boxes[bx] |= b;
        rec();
        rows[r] &= ~b; cols[c] &= ~b; boxes[bx] &= ~b;
        g[best] = 0;
        if (count >= limit) return;
      }
    };

    rec();
    return { count, solution };
  }

  // Antall gitte tall per vanskelighetsgrad
  const TARGET = { easy: 40, medium: 32, hard: 27, expert: 23 };

  /**
   * Lager et nytt brett med entydig løsning.
   * Fjerner tall i symmetriske par og sjekker at løsningen fortsatt er unik.
   */
  function generate(difficulty = 'medium') {
    const target = TARGET[difficulty] ?? TARGET.medium;
    let best = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      const solution = solve(new Array(81).fill(0), 1, true).solution;
      const puzzle = solution.slice();
      let clues = 81;

      const order = shuffle([...Array(41).keys()]); // 0..40, speiles mot 80-i
      for (const i of order) {
        if (clues <= target) break;
        const j = 80 - i;
        const bi = puzzle[i], bj = puzzle[j];
        const removed = i === j ? 1 : 2;
        puzzle[i] = 0; puzzle[j] = 0;
        if (solve(puzzle, 2).count !== 1) {
          puzzle[i] = bi; puzzle[j] = bj;
        } else {
          clues -= removed;
        }
      }

      if (!best || clues < best.clues) best = { puzzle, solution, clues };
      if (clues <= target) break;
    }
    return best;
  }

  return { generate, solve, TARGET };
})();

if (typeof module !== 'undefined') module.exports = Sudoku;
