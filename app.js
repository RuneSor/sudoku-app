(() => {
  'use strict';

  const KEYS = {
    game: 'sudoku.game.v1',
    stats: 'sudoku.stats.v1',
    settings: 'sudoku.settings.v1',
  };
  const DIFFS = { easy: 'Lett', medium: 'Middels', hard: 'Vanskelig', expert: 'Ekspert' };
  const MAX_HISTORY = 500;

  const $ = (s) => document.querySelector(s);

  // ---------- localStorage ----------
  const store = {
    get(k) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
      catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full/private */ }
    },
  };

  let settings = Object.assign(
    { showErrors: true, autoNotes: true, highlightSame: true, lastDifficulty: 'medium' },
    store.get(KEYS.settings)
  );
  let stats = store.get(KEYS.stats) || {};
  let state = null;

  const saveGame = () => state && store.set(KEYS.game, state);
  const saveSettings = () => store.set(KEYS.settings, settings);
  const saveStats = () => store.set(KEYS.stats, stats);

  // ---------- Naboer (rad, kolonne, boks) ----------
  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0, c = i % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
    const p = [];
    for (let j = 0; j < 81; j++) {
      if (j === i) continue;
      const r2 = (j / 9) | 0, c2 = j % 9, b2 = ((r2 / 3) | 0) * 3 + ((c2 / 3) | 0);
      if (r2 === r || c2 === c || b2 === b) p.push(j);
    }
    PEERS.push(p);
  }

  // ---------- DOM ----------
  const boardEl = $('#board');
  const numpadEl = $('#numpad');
  const overlayEl = $('#overlay');
  const cells = [];
  const padButtons = [];

  function buildBoard() {
    for (let i = 0; i < 81; i++) {
      const el = document.createElement('div');
      const r = (i / 9) | 0, c = i % 9;
      el.className = 'cell';
      if (c === 2 || c === 5) el.classList.add('br');
      if (r === 2 || r === 5) el.classList.add('bb');
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');
      boardEl.appendChild(el);
      cells.push(el);
    }
    boardEl.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.cell');
      if (el) select(+el.dataset.i);
    });

    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.innerHTML = `${d}<small></small>`;
      b.addEventListener('click', () => input(d));
      numpadEl.appendChild(b);
      padButtons.push(b);
    }
  }

  // ---------- Spill ----------
  function newGame(diff) {
    stopTimer();
    settings.lastDifficulty = diff;
    saveSettings();
    showOverlay('Lager brett …', false);

    setTimeout(() => {
      const { puzzle, solution } = Sudoku.generate(diff);
      state = {
        v: 1,
        difficulty: diff,
        puzzle,
        solution,
        values: puzzle.slice(),
        notes: new Array(81).fill(0),
        locked: puzzle.map((x) => x !== 0),
        hinted: new Array(81).fill(false),
        selected: null,
        mistakes: 0,
        hints: 0,
        elapsed: 0,
        notesMode: false,
        history: [],
        completed: false,
        paused: false,
      };
      bumpStat(diff, 'played');
      boardEl.classList.remove('solved');
      hideOverlay();
      saveGame();
      render();
      startTimer();
    }, 20);
  }

  const canEdit = () => state && !state.completed && !state.paused;

  function select(i) {
    if (!canEdit()) return;
    state.selected = i;
    render();
  }

  function input(d) {
    if (!canEdit()) return;
    const i = state.selected;
    if (i == null || state.locked[i]) return;

    const entry = [];
    const snap = (j) => entry.push([j, state.values[j], state.notes[j]]);

    if (state.notesMode) {
      if (state.values[i]) return;
      snap(i);
      state.notes[i] ^= 1 << d;
    } else if (state.values[i] === d) {
      snap(i);
      state.values[i] = 0;
    } else {
      snap(i);
      state.values[i] = d;
      state.notes[i] = 0;
      if (settings.autoNotes) {
        for (const j of PEERS[i]) {
          if (state.notes[j] & (1 << d)) { snap(j); state.notes[j] &= ~(1 << d); }
        }
      }
      if (d !== state.solution[i]) {
        state.mistakes++;
        shake(i);
      }
    }

    state.history.push(entry);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    afterChange();
  }

  function erase() {
    if (!canEdit()) return;
    const i = state.selected;
    if (i == null || state.locked[i]) return;
    if (!state.values[i] && !state.notes[i]) return;
    state.history.push([[i, state.values[i], state.notes[i]]]);
    state.values[i] = 0;
    state.notes[i] = 0;
    afterChange();
  }

  function undo() {
    if (!canEdit()) return;
    const entry = state.history.pop();
    if (!entry) return;
    for (let k = entry.length - 1; k >= 0; k--) {
      const [j, v, n] = entry[k];
      if (state.locked[j]) continue;
      state.values[j] = v;
      state.notes[j] = n;
    }
    state.selected = entry[0][0];
    afterChange();
  }

  function hint() {
    if (!canEdit()) return;
    const needs = (j) => !state.locked[j] && state.values[j] !== state.solution[j];
    let i = state.selected;
    if (i == null || !needs(i)) {
      const options = [];
      for (let j = 0; j < 81; j++) if (needs(j)) options.push(j);
      if (!options.length) return;
      i = options[(Math.random() * options.length) | 0];
    }
    const d = state.solution[i];
    state.values[i] = d;
    state.notes[i] = 0;
    state.locked[i] = true;
    state.hinted[i] = true;
    state.hints++;
    state.selected = i;
    if (settings.autoNotes) for (const j of PEERS[i]) state.notes[j] &= ~(1 << d);
    afterChange();
  }

  function toggleNotes() {
    if (!canEdit()) return;
    state.notesMode = !state.notesMode;
    saveGame();
    render();
  }

  const isSolved = () => state.values.every((v, i) => v === state.solution[i]);

  function afterChange() {
    const solved = isSolved();
    if (solved) {
      stopTimer();
      state.completed = true;
      state.selected = null;
    }
    saveGame();
    render();
    if (solved) win();
  }

  function shake(i) {
    const el = cells[i];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  // ---------- Statistikk ----------
  function statFor(diff) {
    return (stats[diff] ||= { played: 0, won: 0, best: null, total: 0 });
  }
  function bumpStat(diff, key) {
    statFor(diff)[key]++;
    saveStats();
  }

  function win() {
    const s = statFor(state.difficulty);
    const t = state.elapsed;
    const record = s.best == null || t < s.best;
    s.won++;
    s.total += t;
    if (record) s.best = t;
    saveStats();

    boardEl.classList.add('solved');
    cells.forEach((el, i) => (el.style.animationDelay = `${((i % 9) + ((i / 9) | 0)) * 30}ms`));

    $('#win-body').innerHTML = `
      <dl>
        <dt>Nivå</dt><dd>${DIFFS[state.difficulty]}</dd>
        <dt>Tid</dt><dd>${fmt(t)}</dd>
        <dt>Feil</dt><dd>${state.mistakes}</dd>
        <dt>Hint brukt</dt><dd>${state.hints}</dd>
        <dt>Beste tid</dt><dd>${fmt(s.best)}</dd>
      </dl>
      ${record && s.won > 1 ? '<p class="record">Ny rekord!</p>' : ''}`;
    setTimeout(() => $('#dlg-win').showModal(), 700);
  }

  function renderStats() {
    $('#stats-body').innerHTML = Object.keys(DIFFS).map((d) => {
      const s = stats[d] || { played: 0, won: 0, best: null, total: 0 };
      const avg = s.won ? s.total / s.won : null;
      return `<tr><td>${DIFFS[d]}</td><td>${s.played}</td><td>${s.won}</td>
        <td>${s.best != null ? fmt(s.best) : '–'}</td><td>${avg != null ? fmt(avg) : '–'}</td></tr>`;
    }).join('');
    $('#set-errors').checked = settings.showErrors;
    $('#set-autonotes').checked = settings.autoNotes;
    $('#set-highlight').checked = settings.highlightSame;
  }

  // ---------- Tidtaker ----------
  let timerId = null, lastTick = 0;

  function startTimer() {
    stopTimer();
    if (!state || state.completed || state.paused) return;
    lastTick = Date.now();
    timerId = setInterval(tick, 1000);
  }
  function tick() {
    const now = Date.now();
    state.elapsed += now - lastTick;
    lastTick = now;
    $('#timer').textContent = fmt(state.elapsed);
    saveGame();
  }
  function stopTimer() {
    if (!timerId) return;
    clearInterval(timerId);
    timerId = null;
    if (state && !state.completed) state.elapsed += Date.now() - lastTick;
  }

  function fmt(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function setPaused(p) {
    if (!state || state.completed) return;
    state.paused = p;
    if (p) {
      stopTimer();
      showOverlay('Pause', true);
    } else {
      hideOverlay();
      startTimer();
    }
    saveGame();
    render();
  }

  function showOverlay(text, withButton) {
    $('#overlay-text').textContent = text;
    $('#btn-resume').hidden = !withButton;
    overlayEl.hidden = false;
  }
  const hideOverlay = () => (overlayEl.hidden = true);

  // ---------- Tegning ----------
  function render() {
    if (!state) return;
    const sel = state.selected;
    const selVal = sel != null ? state.values[sel] : 0;
    const peers = sel != null ? new Set(PEERS[sel]) : null;

    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      const v = state.values[i];
      const given = state.puzzle[i] !== 0;
      const err = settings.showErrors && v && v !== state.solution[i];

      el.classList.toggle('given', given);
      el.classList.toggle('hinted', state.hinted[i]);
      el.classList.toggle('selected', i === sel);
      el.classList.toggle('peer', !!peers && peers.has(i));
      el.classList.toggle('same', settings.highlightSame && !!selVal && v === selVal && i !== sel);
      el.classList.toggle('error', !!err);

      const hl = settings.highlightSame ? selVal : 0;
      const key = v ? `v${v}` : `n${state.notes[i]}:${hl}`;
      if (el._key !== key) {
        el._key = key;
        if (v) {
          el.textContent = v;
        } else if (state.notes[i]) {
          let html = '<div class="notes">';
          for (let d = 1; d <= 9; d++) {
            const on = state.notes[i] & (1 << d);
            html += `<span${on && d === hl ? ' class="hl"' : ''}>${on ? d : ''}</span>`;
          }
          el.innerHTML = html + '</div>';
        } else {
          el.textContent = '';
        }
      }
    }

    const counts = new Array(10).fill(0);
    state.values.forEach((v, i) => { if (v && v === state.solution[i]) counts[v]++; });
    padButtons.forEach((b, k) => {
      const left = 9 - counts[k + 1];
      b.querySelector('small').textContent = left;
      b.classList.toggle('done', left <= 0);
    });
    numpadEl.classList.toggle('notes-mode', state.notesMode);

    $('#diff-label').textContent = DIFFS[state.difficulty];
    $('#mistakes').textContent = `Feil: ${state.mistakes}`;
    $('#timer').textContent = fmt(state.elapsed);
    $('#btn-notes').classList.toggle('on', state.notesMode);
    $('#notes-badge').textContent = state.notesMode ? 'PÅ' : 'AV';
  }

  // ---------- Hendelser ----------
  function bindEvents() {
    $('#btn-new').addEventListener('click', () => $('#dlg-new').showModal());
    $('#dlg-new').addEventListener('close', () => {
      const v = $('#dlg-new').returnValue;
      if (DIFFS[v]) newGame(v);
    });

    $('#dlg-win').addEventListener('close', () => {
      if ($('#dlg-win').returnValue === 'new') $('#dlg-new').showModal();
    });

    $('#btn-stats').addEventListener('click', () => {
      renderStats();
      $('#dlg-stats').showModal();
    });
    const bindSetting = (id, key) =>
      $(id).addEventListener('change', (e) => {
        settings[key] = e.target.checked;
        saveSettings();
        cells.forEach((el) => (el._key = null));
        render();
      });
    bindSetting('#set-errors', 'showErrors');
    bindSetting('#set-autonotes', 'autoNotes');
    bindSetting('#set-highlight', 'highlightSame');
    $('#btn-reset-stats').addEventListener('click', () => {
      if (confirm('Nullstille all statistikk?')) {
        stats = {};
        saveStats();
        renderStats();
      }
    });

    $('#btn-pause').addEventListener('click', () => state && setPaused(!state.paused));
    $('#btn-resume').addEventListener('click', () => setPaused(false));

    document.querySelector('.tools').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      ({ undo, erase, notes: toggleNotes, hint })[b.dataset.tool]?.();
    });

    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]') || !state) return;
      const k = e.key;
      if (/^[1-9]$/.test(k)) return input(+k);
      if (k === 'Backspace' || k === 'Delete' || k === '0') return erase();
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
      if (k.toLowerCase() === 'n') return toggleNotes();
      if (k.toLowerCase() === 'h') return hint();
      if (k === ' ') { e.preventDefault(); return setPaused(!state.paused); }
      const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
      if (moves[k]) {
        e.preventDefault();
        const cur = state.selected ?? 40;
        let r = (cur / 9) | 0, c = cur % 9;
        if (k === 'ArrowUp') r = (r + 8) % 9;
        if (k === 'ArrowDown') r = (r + 1) % 9;
        if (k === 'ArrowLeft') c = (c + 8) % 9;
        if (k === 'ArrowRight') c = (c + 1) % 9;
        select(r * 9 + c);
      }
    });

    // Pause når appen går i bakgrunnen, fortsett når den kommer tilbake
    document.addEventListener('visibilitychange', () => {
      if (!state) return;
      if (document.hidden) {
        stopTimer();
        saveGame();
      } else if (!state.paused && !state.completed) {
        startTimer();
      }
    });
    window.addEventListener('pagehide', () => { stopTimer(); saveGame(); });
  }

  // ---------- Oppstart ----------
  function isValidState(s) {
    return s && s.v === 1 && Array.isArray(s.values) && s.values.length === 81 &&
      Array.isArray(s.solution) && s.solution.length === 81 && DIFFS[s.difficulty];
  }

  function init() {
    buildBoard();
    bindEvents();

    const saved = store.get(KEYS.game);
    if (isValidState(saved)) {
      state = saved;
      render();
      if (state.completed) boardEl.classList.add('solved');
      else if (state.paused) showOverlay('Pause', true);
      else startTimer();
    } else {
      newGame(settings.lastDifficulty || 'medium');
    }
  }

  init();
})();
