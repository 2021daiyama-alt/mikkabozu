// β版ならではの機能：ダイエット法の自由追加と提案、意見・結果の送信、記録の引っこし。

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.className = ''; }, 2800);
}
function rawName(id) {
  const c = (state.custom || []).find(x => x.id === id);
  return c ? c.name : (METHODS.find(m => m.id === id) || {}).name || id;
}

// 運営に届ける。受け取り口（CONFIG.endpoint）があれば自動送信、なければ共有かコピーで送ってもらう。
// 書いたものは必ず端末内にも残す（届け方が決まる前に書いた分を失わないため）。
async function deliver(kind, text) {
  (state.outbox || (state.outbox = [])).push({ kind, text, at: new Date().toISOString() });
  save();
  if (CONFIG.endpoint) {
    try {
      await fetch(CONFIG.endpoint, {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ kind, text, version: CONFIG.version, at: new Date().toISOString() }),
      });
      toast('運営に送りました。ありがとう！');
      return;
    } catch { /* 届かなければ下の方法に切りかえる */ }
  }
  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  modal = { title: '運営に送る', lead: 'いまは自動では届きません。下の文をコピーして、運営に送ってください。', text };
  render();
}

// 利用者が追加したダイエット法は、本人の操作なしで運営に届ける（その旨は画面に明記している）。
// 受け取り口がまだ無いあいだは端末内で「未送信」として待ち、用意できたら次にアプリを開いたときにまとめて送る。
function queue(kind, text, data) {
  (state.outbox || (state.outbox = [])).push({ kind, text, data, at: new Date().toISOString(), sent: false });
  save(); flush();
}
async function flush() {
  if (!CONFIG.endpoint) return;
  for (const o of (state.outbox || []).filter(x => x.sent === false)) {
    try {
      await fetch(CONFIG.endpoint, {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ kind: o.kind, text: o.text, data: o.data, version: CONFIG.version, at: o.at }),
      });
      o.sent = true; save();
    } catch { return; }
  }
}

function resultText(withNotes) {
  const lines = rounds().filter(faced).map(r =>
    `・${rawName(r.methodId)}：3日中${r.checkins.length}日できた／${r.rating ? RATINGS[r.rating].split(' ')[1] : '感想はまだ'}` +
    (withNotes && r.note && r.note.trim() ? `／メモ：${r.note.trim()}` : ''));
  const mine = (state.custom || []).map(c => c.name);
  return [
    `【みっかぼうず ${CONFIG.version} 使ってみた結果】`,
    `開始から${sinceStart()}日目／試した種類 ${triedIds().length}／できた日 ${checkins().length}`,
    ...lines,
    ...(mine.length ? [`じぶんで追加した方法：${mine.join('、')}`] : []),
  ].join('\n');
}

let importArmed = false;
Object.assign(actions, {
  close: () => { sheetId = null; modal = null; },
  toggle: k => { draft[k] = draft[k] === false; },
  addMethod: () => {
    const name = (draft.mName || '').trim(), todo = (draft.mTodo || '').trim(), why = (draft.mWhy || '').trim();
    if (!name || !todo) { toast('名前と「やること」を書いてください'); return; }
    const cat = draft.mCat || 'food';
    (state.custom || (state.custom = [])).push({ id: 'c' + Date.now(), name, todo, cat, why });
    draft.mName = draft.mTodo = draft.mWhy = '';
    toast('追加しました。「さがす」から選べます');
    queue('提案', `【ダイエット法の提案】\n名前：${name}\nやること：${todo}\nジャンル：${CATS[cat]}${why ? `\n良いと思う理由：${why}` : ''}`, { name, todo, cat, why });
  },
  delMethod: id => {
    if (rounds().some(r => r.methodId === id)) return;
    state.custom = (state.custom || []).filter(c => c.id !== id); sheetId = null;
  },
  sendFb: () => {
    const fb = (draft.fb || '').trim();
    if (!fb) { toast('ひとこと書いてから送ってください'); return; }
    draft.fb = '';
    deliver('意見', `【意見・気づき】\n${fb}`);
  },
  fbAbout: id => { draft.fb = `「${rawName(id)}」について：`; sheetId = null; tab = 'beta'; },
  sendResult: () => { deliver('結果', resultText(draft.rNotes !== false)); },
  showOutbox: () => {
    modal = { title: 'これまでに書いたもの', lead: '提案・意見・結果として書いた内容です。', text: (state.outbox || []).map(o => `${o.at.slice(0, 10)}\n${o.text}`).join('\n\n――――\n\n') };
  },
  exportData: () => {
    modal = { title: '記録を書き出す', lead: '下の文字をコピーして保存してください。新しい場所で「読み込む」に貼りつけると、記録を引きつげます。', text: JSON.stringify(state) };
  },
  importData: () => {
    let obj;
    try { obj = JSON.parse(draft.imp || ''); } catch { obj = null; }
    if (!obj || !Array.isArray(obj.history)) { importArmed = false; toast('読み込めませんでした。書き出した文字をそのまま貼りつけてください'); return; }
    if (!importArmed) { importArmed = true; return; }
    state = Object.assign({ current: null, history: [], offset: 0, custom: [], outbox: [], body: [] }, obj);
    importArmed = false; draft.imp = ''; tab = 'home';
    toast('記録を読み込みました');
  },
  copy: () => {
    const el = document.getElementById('modalText');
    el.focus(); el.select();
    const done = () => toast('コピーしました');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(el.value).then(done, () => { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  },
});

function modalSheet() {
  return `
  <div class="overlay" data-act="close"></div>
  <div class="sheet" role="dialog" aria-label="${modal.title}">
    <h2>${modal.title}</h2>
    <p class="muted center">${modal.lead}</p>
    <textarea id="modalText" class="note-input out" rows="8" readonly>${esc(modal.text)}</textarea>
    <button class="btn primary" data-act="copy">コピーする</button>
    <button class="btn" data-act="close">とじる</button>
  </div>`;
}

function viewBeta() {
  const d = k => esc(draft[k] || '');
  const on = k => (draft[k] !== false ? 'on' : '');
  const hasRecord = rounds().some(faced);
  const outbox = (state.outbox || []).length;
  return `
  <section class="page">
    <h1>β版について</h1>
    <div class="betabox">
      <b>いまは試作（β版）です。</b>
      <ul>
        <li>ダイエット法も使い勝手も、まだ探している途中です。</li>
        <li>記録はこの端末の中だけに保存されます。運営に届くのは、あなたが追加したダイエット法と、「送る」を押したものだけです。</li>
        <li>内容は予告なく変わることがあります。</li>
      </ul>
      <small>バージョン ${CONFIG.version}</small>
    </div>

    <h3>ダイエット法を追加・提案する</h3>
    <p class="muted">試してみたい方法を書くと、あなたの選択肢に加わります。追加した方法は運営にも届き、良いものはほかの人の選択肢にも載せていきます。</p>
    <label class="f">名前<input class="field" data-draft="mName" maxlength="30" placeholder="例：エレベーターを待つあいだ かかと上げ" value="${d('mName')}"></label>
    <label class="f">やること<textarea class="note-input" data-draft="mTodo" rows="2" maxlength="100" placeholder="3日間、毎日なにをするか">${d('mTodo')}</textarea></label>
    <label class="f">ジャンル<select class="field" data-draft="mCat">${Object.entries(CATS).map(([k, v]) =>
      `<option value="${k}" ${(draft.mCat || 'food') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="f">良いと思う理由 <small>任意</small><textarea class="note-input" data-draft="mWhy" rows="2" maxlength="100">${d('mWhy')}</textarea></label>
    <button class="btn primary" data-act="addMethod">追加する</button>

    <h3>意見・気づきを送る</h3>
    <p class="muted">使いにくいところ、わかりにくい説明、ほしい機能など、なんでも。</p>
    <textarea class="note-input" data-draft="fb" rows="3" maxlength="500" placeholder="気づいたことを書いてください">${d('fb')}</textarea>
    <button class="btn primary" data-act="sendFb">送る</button>

    <h3>使ってみた結果を運営に送る</h3>
    <p class="muted">どの方法が気持ちよく続けられたかを、ダイエット法の見直しに使います。送られるのは下の内容だけです。</p>
    ${hasRecord ? `
    <pre class="preview">${esc(resultText(draft.rNotes !== false))}</pre>
    <button class="chip check ${on('rNotes')}" data-act="toggle" data-val="rNotes">${draft.rNotes !== false ? '✓ ' : ''}ひとことメモも含める</button>
    <button class="btn primary" data-act="sendResult">この内容を送る</button>` : '<p class="muted">まだ記録がありません。3日やってみたら送れます。</p>'}
    ${outbox ? `<button class="link" data-act="showOutbox">これまでに書いたもの（${outbox}件）を見る</button>` : ''}

    <h3>記録の引っこし</h3>
    <p class="muted">記録はこの端末のこの場所にだけあります。アプリの置き場所（URL）が変わるときや、機種を変えるときに使います。</p>
    <button class="btn small" data-act="exportData">記録を書き出す</button>
    <textarea class="note-input" data-draft="imp" rows="2" placeholder="書き出した文字をここに貼りつける">${d('imp')}</textarea>
    <button class="btn small ${importArmed ? 'danger' : ''}" data-act="importData">${importArmed ? 'もう一度押すと、いまの記録と入れかえ' : '貼りつけた記録を読み込む'}</button>

    <h3>お試し用</h3>
    <div class="settings">
      <button class="btn small" data-act="nextday">日付を1日進める</button>
      <button class="btn small danger" data-act="reset">${resetArmed ? 'もう一度押すと全データを消去' : 'データをリセット'}</button>
      <p class="muted">アプリ内の今日：${short(today())}${state.offset ? `（+${state.offset}日）` : ''}</p>
    </div>

    <h3>新しくなったところ</h3>
    <ul class="changes">${CHANGES.map(([v, t]) => `<li><b>${v}</b>${t}</li>`).join('')}</ul>
  </section>`;
}

flush();
