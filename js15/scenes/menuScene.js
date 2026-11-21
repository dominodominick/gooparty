import { app } from '../app.js';
import { GAME_TITLE, BUILD } from '../config.js';
import { Session } from '../session.js';
import { esc } from '../util/dom.js';
import { getKey, getName, setName, currentMii, setMii } from '../identity.js';
import { openMiiCreator } from '../miiCreator.js';
import { miiFace } from '../world/miiHead.js';
import { parseMii, DEFAULT_MII } from '../world/miic.js';

// Start menu -> "Play" screen (create game / join game) -> settings.
export class MenuScene {
  constructor({ panel = 'main', notice = '', code = '' } = {}) {
    this.panel = panel; this.notice = notice; this.isError = !!notice; this.prefill = code; this.busy = false;
  }

  enter() { this.render(); }
  exit() {}

  render() {
    const ui = app.ui;
    if (this.panel === 'main') {
      ui.innerHTML = `
        <a class="home-link" href="https://dominodominick.com" target="_top" rel="noopener">&larr; dominodominick.com</a>
        <section class="panel">
          ${this.miiButton()}
          <h1>${esc(GAME_TITLE)}</h1>
          <p class="tagline">Board game and minigames for up to 6 players, right in the browser.</p>
          <div class="stack">
            <button class="btn" data-act="play">Play</button>
            <button class="btn ghost" data-act="settings">Settings</button>
            <button class="btn ghost" data-act="viewer">Island viewer</button>
          </div>
          <p class="notice ${this.isError ? 'error' : ''}" role="status">${esc(this.notice)}</p>
          <p class="tagline" style="margin:8px 0 0;font-size:0.8rem">Build ${esc(BUILD)}</p>
        </section>`;
    } else if (this.panel === 'online') {
      ui.innerHTML = `
        <section class="panel">
          <h2>Join a game</h2>
          <div class="stack">
            <button class="btn" data-act="create" ${this.busy ? 'disabled' : ''}>Create game</button>
            <p class="tagline" style="margin:4px 0 0">or enter a friend's room code</p>
            <input type="text" id="code" class="code-input" maxlength="5" autocomplete="off" spellcheck="false"
                   aria-label="Room code" value="${esc(this.prefill)}">
            <button class="btn" data-act="join" ${this.busy ? 'disabled' : ''}>Join game</button>
            <button class="btn ghost" data-act="offline" ${this.busy ? 'disabled' : ''}>Play offline (CPU players)</button>
            <button class="btn ghost small" data-act="back">Back</button>
          </div>
          <p class="notice ${this.isError ? 'error' : ''}" role="status">${esc(this.notice)}</p>
        </section>`;
    } else {
      ui.innerHTML = `
        <section class="panel">
          <h2>Settings</h2>
          <label class="field"><span>Your name</span>
            <input type="text" id="name" maxlength="12" autocomplete="off" value="${esc(getName())}" placeholder="Player">
          </label>
          <p class="tagline">Volume and other options will appear here.</p>
          <button class="btn" data-act="back">Done</button>
        </section>`;
    }
    ui.onclick = (e) => this.click(e);
    const name = ui.querySelector('#name');
    if (name) name.onchange = () => setName(name.value.trim());
    const code = ui.querySelector('#code');
    if (code) {
      code.oninput = () => { code.value = code.value.toUpperCase(); this.prefill = code.value; };
      code.onkeydown = (e) => { if (e.key === 'Enter') this.join(); };
    }
  }

  /** Your Mii's face, on a round button that opens the Mii creator. */
  miiButton() {
    const m = currentMii(), face = m && m.face;
    return `<button class="mii-face" data-act="mii" title="${m ? 'Edit your Mii' : 'Make your Mii'}" ${this.busy ? 'disabled' : ''}>
      ${face ? `<img src="${esc(face)}" alt="Your Mii">` : '<span class="mii-blank" aria-hidden="true"></span>'}
      <span class="mii-label">${m ? 'Your Mii' : 'Make your Mii'}</span></button>`;
  }

  /** Open the creator on your Mii (or a new one); keep what you save, with a picture of its face. */
  async editMii() {
    const before = currentMii();
    this.busy = true; this.say('Opening the Mii creator...', false);
    const r = await openMiiCreator(before ? before.data : DEFAULT_MII);
    this.busy = false;
    if (r && r.error) return this.say(r.error);
    if (!r) return this.say('', false);
    const m = parseMii(r.data);
    if (!m) return this.say('That Mii could not be read.');
    const face = await miiFace(r.data, parseMii);
    setMii({ data: r.data, face: face || (before && before.face) || null });
    const name = getName();
    if (!name || (before && name === (parseMii(before.data) || {}).name)) setName(m.name.slice(0, 12)); // your name follows your Mii's, unless you typed your own
    this.say('', false);
  }

  say(msg, isError = true) { this.notice = msg; this.isError = isError; this.render(); }

  click(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || this.busy) return;
    if (act === 'play') { this.panel = 'online'; this.notice = ''; this.render(); }
    else if (act === 'settings') { this.panel = 'settings'; this.render(); }
    else if (act === 'mii') this.editMii();
    else if (act === 'viewer') app.openViewer();
    else if (act === 'back') { this.panel = 'main'; this.notice = ''; this.render(); }
    else if (act === 'create') this.create();
    else if (act === 'offline') this.create(true);
    else if (act === 'join') this.join();
  }

  async create(offline = false) {
    this.busy = true; this.say(offline ? 'Starting...' : 'Creating room...', false);
    try {
      const s = await Session.createHost({ name: getName(), key: getKey(), mii: currentMii()?.data || null, offline });
      app.setSession(s);
    } catch (e) {
      this.busy = false; this.say(e.message);
    }
  }

  async join() {
    const code = (this.prefill || '').trim().toUpperCase();
    if (code.length !== 5) return this.say('Enter the 5-character room code.');
    this.busy = true; this.say('Connecting...', false);
    try {
      const s = await Session.join({ code, name: getName(), key: getKey(), mii: currentMii()?.data || null });
      app.setSession(s);
    } catch (e) {
      this.busy = false; this.say(e.message);
    }
  }
}
