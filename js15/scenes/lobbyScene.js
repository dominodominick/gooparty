import { app } from '../app.js';
import { MAX_PLAYERS, PLAYER_COLORS, NPC_DIFFICULTIES } from '../config.js';
import { esc } from '../util/dom.js';
import { setName } from '../identity.js';

// Player preview: every seat with its color. Host can add CPUs, set difficulty and start.
export class LobbyScene {
  enter() {
    const s = app.session;
    app.ui.innerHTML = `
      <section class="panel wide" aria-label="Lobby">
        <h2>Lobby</h2>
        <div class="code-row">
          <span>Room code</span>
          <strong class="room-code">${esc(s.code)}</strong>
          <button class="btn small ghost" data-act="copy-code">Copy code</button>
          <button class="btn small ghost" data-act="copy-link">Copy invite link</button>
        </div>
        <label class="field" style="max-width:280px"><span>Your name</span>
          <input type="text" id="my-name" maxlength="12" autocomplete="off">
        </label>
        <ul id="seats" class="seats"></ul>
        <div id="foot" class="foot"></div>
        <p id="msg" class="notice" role="status"></p>
      </section>`;
    app.ui.onclick = (e) => this.click(e);
    app.ui.onchange = (e) => {
      if (e.target.id === 'my-name') {
        const n = e.target.value.trim();
        if (n) { setName(n); app.session.setName(n); }
      } else if (e.target.dataset.slot !== undefined) {
        app.session.setDifficulty(Number(e.target.dataset.slot), e.target.value);
      }
    };
    const me = s.roster?.players[s.mySlot];
    app.ui.querySelector('#my-name').value = me ? me.name : '';
    this.onRoster();
  }

  exit() { app.ui.onclick = null; app.ui.onchange = null; }

  say(msg) { const m = app.ui.querySelector('#msg'); if (m) m.textContent = msg; }

  onRoster() {
    const s = app.session, r = s.roster, host = s.role === 'host';
    const seats = app.ui.querySelector('#seats');
    seats.innerHTML = r.players.map((p, i) => {
      const c = PLAYER_COLORS[i];
      const style = `--c:${c.hex};--ink-on:${c.ink}`;
      if (!p) {
        return `<li class="seat empty" style="${style}">
          <span class="badge">${i + 1}</span>
          <div><div class="seat-name">Open seat</div>
          <div class="seat-sub">${host ? '<button class="btn small ghost" data-act="add-npc">Add CPU</button>' : 'Waiting for a player'}</div></div></li>`;
      }
      let sub = '';
      if (p.kind === 'human') {
        sub = [i === 0 ? 'Host' : '', i === s.mySlot ? 'You' : ''].filter(Boolean).join(', ') || c.name;
      } else {
        const left = p.wasHuman && !p.connected;
        sub = left ? 'Left. CPU until they rejoin' : '';
        if (host) {
          const opts = NPC_DIFFICULTIES.map((d) => `<option ${d === p.difficulty ? 'selected' : ''}>${d}</option>`).join('');
          sub += `<select data-slot="${i}" aria-label="CPU ${i + 1} difficulty">${opts}</select>
                  <button class="btn small ghost" data-act="remove-npc" data-slot="${i}">Remove</button>`;
        } else if (!left) sub = `CPU, ${p.difficulty}`;
      }
      return `<li class="seat" style="${style}">
        <span class="badge">${i + 1}</span>
        <div><div class="seat-name">${esc(p.name)}</div><div class="seat-sub">${sub}</div></div></li>`;
    }).join('');

    const count = r.players.filter(Boolean).length;
    app.ui.querySelector('#foot').innerHTML = `
      <span>${count} of ${MAX_PLAYERS} seats filled</span>
      <span class="row">
        <button class="btn ghost" data-act="leave">Leave room</button>
        ${host
          ? `<button class="btn ghost small" data-act="start-test" ${count < 2 ? 'disabled' : ''}>Pointer test</button>
             <button class="btn" data-act="start" ${count < 2 ? 'disabled' : ''}>Start game</button>`
          : '<span>Waiting for the host to start</span>'}
      </span>`;
  }

  async copy(text, ok) {
    try { await navigator.clipboard.writeText(text); this.say(ok); }
    catch { this.say(`Could not copy automatically. Share this instead: ${text}`); }
  }

  click(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const s = app.session;
    switch (btn.dataset.act) {
      case 'copy-code': this.copy(s.code, 'Room code copied.'); break;
      case 'copy-link': this.copy(`${location.origin}${location.pathname}?room=${s.code}`, 'Invite link copied.'); break;
      case 'add-npc': { const r = s.addNpc(); if (!r.ok) this.say(r.reason); break; }
      case 'remove-npc': s.removeNpc(Number(btn.dataset.slot)); break;
      case 'start': { const r = s.startGame('board'); if (!r.ok) this.say(r.reason); break; }
      case 'start-test': { const r = s.startGame('pointerTest'); if (!r.ok) this.say(r.reason); break; }
      case 'leave': app.leave(); break;
    }
  }
}
