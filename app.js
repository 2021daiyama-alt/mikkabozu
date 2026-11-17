// みっかぼうず — 状態はすべて端末の localStorage に保存する。
const KEY = 'mikkabozu.v1';
const ROUND = 3; // 1チャレンジ = 3日分の記録
const COOLDOWN = 30; // 一度試した方法は、この日数が過ぎるまで選べない（まずは別の方法を試してもらう）
// 結果ではなく「気持ちよく続けられたか」を聞く。
const RATINGS = { good: '😊 心地よかった', ok: '😐 ふつう', bad: '😣 しんどかった' };

let state = load();
let tab = 'home';
let filter = 'all';
let sheetId = null;
let resetArmed = false;
let modal = null; // 文字を見せてコピーしてもらう画面（beta.js が使う）
const draft = {}; // 入力途中の文字。画面を描き直しても消えないようにここに持つ

function load() {
  const base = { current: null, history: [], offset: 0, custom: [], outbox: [], body: [], ongoing: [], stopped: {} };
  try { return Object.assign(base, JSON.parse(localStorage.getItem(KEY)) || {}); }
  catch { return base; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

// メモは利用者が自由に書く文字なので、画面に出すときは必ずこれを通す。
function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---- 日付 ----
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function now() { const d = new Date(); d.setDate(d.getDate() + state.offset); return d; }
function today() { return fmt(now()); }
function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); return fmt(new Date(y, m - 1, d + n)); }
function short(s) { const [, m, d] = s.split('-'); return `${+m}/${+d}`; }

// ---- 集計 ----
function methods() {
  return [...METHODS, ...(state.custom || []).map(c => ({
    id: c.id, emoji: '✍️', cat: c.cat, custom: true, tip: '',
    name: esc(c.name), todo: esc(c.todo), why: esc(c.why || ''),
  }))];
}
const M = id => methods().find(m => m.id === id);
function rounds() { return state.current ? [...state.history, state.current] : state.history; }
// 1チャレンジの日ごとの記録。checkins＝やった日、misses＝できなかった日。どちらも「向き合った1日」として3日に数える。
function dayLog(r) {
  return [...r.checkins.map(date => ({ date, done: true })), ...(r.misses || []).map(date => ({ date, done: false }))]
    .sort((a, b) => a.date.localeCompare(b.date));
}
function faced(r) { return r.checkins.length + (r.misses || []).length; }
function days() { return rounds().flatMap(r => dayLog(r).map(d => ({ ...d, methodId: r.methodId }))); }
function checkins() { return days().filter(d => d.done); }
function recordedToday() { return days().some(d => d.date === today()); }
function triedIds() { return [...new Set(rounds().filter(faced).map(r => r.methodId))]; }
// 試した方法がまた選べるようになる日。まだ待ち期間中ならその日付、選べるなら null。
function cooldownUntil(id) {
  if (isOngoing(id)) return null; // 続けている間は「継続中」として別に扱う
  const dates = rounds().filter(r => r.methodId === id && faced(r)).flatMap(r => dayLog(r).map(d => d.date));
  const stopped = (state.stopped || {})[id]; // 継続をやめた日からも1ヶ月
  if (stopped) dates.push(stopped);
  const last = dates.sort().pop();
  if (!last) return null;
  const until = addDays(last, COOLDOWN);
  return today() < until ? until : null;
}
function methodStats(id) {
  const rs = rounds().filter(r => r.methodId === id && faced(r));
  const rated = [...rs].reverse().find(r => r.rating);
  return { days: rs.reduce((n, r) => n + r.checkins.length, 0), rating: rated ? rated.rating : null };
}

// ---- 相性レポート ----
// 1チャレンジごとの点数：3日やりきったあとの評価だけを使う。
const AXES = [['how', 'やり方', () => HOWS], ['time', 'タイミング', () => TIMES], ['cat', 'ジャンル', () => CATS]];
const REPORT_MIN = 2;
function roundScore(r) {
  // 「継続しながら次へ」を選んだ方法は、感想に加えて少し強い手がかりとして数える
  return r.rating ? { good: 1, ok: 0, bad: -1 }[r.rating] + (r.kept ? 0.5 : 0) : null;
}
function report() {
  const scored = rounds().map(r => ({ m: M(r.methodId), s: roundScore(r) })).filter(x => x.s !== null);
  const axes = AXES.map(([key, title, names]) => {
    const g = {};
    scored.forEach(({ m, s }) => { if (m[key] == null) return; const v = g[m[key]] || (g[m[key]] = { n: 0, sum: 0 }); v.n++; v.sum += s; });
    const rows = Object.entries(g).map(([k, v]) => ({ key, label: names()[k], n: v.n, avg: v.sum / v.n }))
      .sort((a, b) => b.avg - a.avg || b.n - a.n);
    return { key, title, g, rows };
  });
  const affinity = m => axes.reduce((t, a) => t + (a.g[m[a.key]] ? a.g[m[a.key]].sum / a.g[m[a.key]].n : 0), 0);
  const cur = state.current && state.current.methodId;
  const recs = scored.length < REPORT_MIN ? [] : methods().filter(m => m.id !== cur && !isOngoing(m.id) && !cooldownUntil(m.id) && methodStats(m.id).rating !== 'bad')
    .map(m => ({ m, a: affinity(m) })).filter(x => x.a > 0).sort((x, y) => y.a - x.a).slice(0, 3).map(x => x.m);
  const main = axes.slice(0, 3).flatMap(a => a.rows);
  // 見出しは回数の多い傾向を優先する（1回だけの結果で断定しない）
  const w = r => r.avg * Math.sqrt(r.n);
  const best = [...main].sort((a, b) => w(b) - w(a)).find(r => r.avg > 0);
  const worst = [...main].sort((a, b) => w(a) - w(b)).find(r => r.avg < 0);
  return { count: scored.length, axes, recs, best, worst };
}
function verdict(avg) { return avg > 0.25 ? ['合う', 'good'] : avg < -0.25 ? ['続きにくい', 'bad'] : ['ふつう', 'mid']; }

function reportCard() {
  const r = report();
  if (r.count < REPORT_MIN) {
    return `
    <div class="report locked">
      <div class="report-head">🔎 相性レポート</div>
      <p class="muted">3日ごとに「気持ちよくできたか」をえらぶたびに、あなたに合うダイエットの傾向がわかってきます。あと<b>${REPORT_MIN - r.count}回</b>でレポートが出ます。</p>
    </div>`;
  }
  const lines = [];
  if (r.best) lines.push(`いまのところ <b>「${r.best.label}」</b> が合っています。`);
  if (r.worst) lines.push(`<b>「${r.worst.label}」</b> は続きにくいようです。`);
  if (!lines.length) lines.push('まだはっきりした傾向は出ていません。いろいろ試してみましょう。');
  const axes = r.axes.filter(a => a.rows.length).map(a => `
    <div class="axis">
      <h4>${a.title}</h4>
      ${a.rows.map(row => { const [word, cls] = verdict(row.avg); return `
      <div class="meter-row">
        <span class="meter-label">${row.label}</span>
        <span class="meter"><i class="${cls}" style="width:${Math.round((row.avg + 1) * 45 + 10)}%"></i></span>
        <span class="meter-word ${cls}">${word}<small>${row.n}回</small></span>
      </div>`; }).join('')}
    </div>`).join('');
  const recs = r.recs.length ? `
    <h4>次に合いそうな3日</h4>
    <div class="picks">${r.recs.map(m =>
      `<button class="pick" data-act="open" data-val="${m.id}"><span>${m.emoji}</span>${m.name}</button>`).join('')}</div>` : '';
  return `
  <div class="report">
    <div class="report-head">🔎 相性レポート<span>${r.count}回の評価から</span></div>
    <p class="report-line">${lines.join('<br>')}</p>
    ${axes}
    ${recs}
    <p class="muted">${r.count < 5 ? 'まだ回数が少ないので、仮の傾向です。' : ''}「気持ちよくできたか」の答えだけで出しています。体重の増減は使っていません。</p>
  </div>`;
}

// ---- 操作 ----
function archive() {
  const c = state.current;
  if (!c) return;
  if (faced(c)) {
    state.history.push({ ...c, endedAt: today(), outcome: faced(c) >= ROUND ? 'completed' : 'switched' });
  }
  state.current = null;
}
// 1日につき記録は1つ。3日分たまったら、それ以上は残せない。
function record(date, done) {
  const c = state.current;
  if (!c || faced(c) >= ROUND || days().some(d => d.date === date)) return;
  (done ? c.checkins : (c.misses || (c.misses = []))).push(date);
  c.last = date;
}
// いまのチャレンジで、記録し忘れている過去の日（始めた日〜きのう。さかのぼれるのは6日前まで）。
function missedDates() {
  const c = state.current;
  if (!c || faced(c) >= ROUND) return [];
  const taken = new Set(days().map(d => d.date)), out = [];
  for (let i = 6; i >= 1; i--) {
    const d = addDays(today(), -i);
    if (d >= c.startedAt && !taken.has(d)) out.push(d);
  }
  return out;
}
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function dayLabel(s) {
  const [y, m, d] = s.split('-').map(Number), diff = Math.round((new Date(now().toDateString()) - new Date(y, m - 1, d)) / 864e5);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）${diff === 1 ? ' きのう' : diff === 2 ? ' おととい' : ''}`;
}

// 挑戦中は、3日やりきって評価するまで次を選べない（途中で変えない）。
function locked() {
  const c = state.current;
  return !!c && (faced(c) < ROUND || !c.rating);
}
function start(id) {
  if (locked() || cooldownUntil(id) || isOngoing(id)) return;
  archive();
  state.current = { methodId: id, startedAt: today(), checkins: [], misses: [], rating: null };
  sheetId = null; tab = 'home';
}
const actions = {
  tab: v => { tab = v; sheetId = null; resetArmed = false; },
  filter: v => { filter = v; },
  open: v => { sheetId = v; },
  close: () => { sheetId = null; },
  start,
  checkin: () => record(today(), true),
  miss: () => record(today(), false),
  // 記録し忘れた日を、あとから残す。val は「日付|1（やった）か 0（できなかった）」
  fill: val => { const [date, done] = val.split('|'); if (missedDates().includes(date)) record(date, done === '1'); },
  // 押しまちがい用：直前に残した記録を1つだけ取り消せる
  undo: () => {
    const c = state.current;
    if (!c || !c.last) return;
    c.checkins = c.checkins.filter(d => d !== c.last);
    c.misses = (c.misses || []).filter(d => d !== c.last);
    c.last = null; c.rating = null;
  },
  rate: v => { if (state.current) state.current.rating = v; },
  switch: () => { if (!locked()) { draft.swap = false; archive(); tab = 'catalog'; } },
  browse: () => { tab = 'catalog'; },
  nextday: () => { state.offset++; },
  reset: () => {
    if (!resetArmed) { resetArmed = true; return; }
    state = { current: null, history: [], offset: 0, custom: [], outbox: [], body: [], ongoing: [], stopped: {} }; resetArmed = false; tab = 'home';
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act !== 'reset') resetArmed = false;
  actions[el.dataset.act](el.dataset.val);
  save(); render();
});

document.addEventListener('input', e => {
  if (e.target.id === 'note' && state.current) { state.current.note = e.target.value; save(); }
  if (e.target.dataset.draft) draft[e.target.dataset.draft] = e.target.value;
});

// ---- 描画 ----
// 大事な数字は「試した種類」と「できた日の累計」。開始からの日数は補足として小さく出す。
function sinceStart() {
  const first = rounds().map(r => r.startedAt).sort()[0];
  if (!first) return 0;
  const [y, m, d] = first.split('-').map(Number), t = now();
  return Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(y, m - 1, d)) / 864e5) + 1;
}
function hero() {
  const total = checkins().length, kinds = triedIds().length, since = sinceStart();
  return `
  <section class="hero">
    <div class="duo">
      <div><small>試した種類</small><b>${kinds}</b><i>種類</i></div>
      <div><small>できた日の累計</small><b>${total}</b><i>日</i></div>
    </div>
    <p class="hero-line">${since ? `ダイエット開始から${since}日目${ongoing().length ? ` ・ 続けている習慣 ${ongoing().length}個` : ''}` : '気になるものを、まず3日。自分の体で試して、合うものを探そう。'}</p>
  </section>`;
}

function dots(log) {
  return `<div class="dots">${[0, 1, 2].map(i => {
    const d = log[i];
    return `<div class="dot ${d ? (d.done ? 'on' : 'miss') : ''}"><span>${d ? (d.done ? '✓' : '–') : i + 1}</span><small>${d ? short(d.date) : `${i + 1}日目`}</small></div>`;
  }).join('')}</div>`;
}

function currentCard() {
  const c = state.current;
  if (!c) {
    const recs = report().recs;
    const picks = recs.length ? recs : [...STARTERS.map(M), ...methods()].filter((m, i, a) => a.indexOf(m) === i && !cooldownUntil(m.id) && !isOngoing(m.id)).slice(0, 3);
    return `
    <section class="card">
      <h2>${state.history.length ? '次の3日間をえらぼう' : '最初の3日間をえらぼう'}</h2>
      <p class="muted">${recs.length ? 'これまでの評価から、合いそうなものを選びました。' : 'まず3日やりきる。終わったら、次の方法へ。'}</p>
      <div class="picks">${picks.map(m =>
        `<button class="pick" data-act="open" data-val="${m.id}"><span>${m.emoji}</span>${m.name}</button>`).join('')}</div>
      <button class="btn primary" data-act="browse">ダイエット法をさがす</button>
    </section>`;
  }
  const m = M(c.methodId), log = dayLog(c), n = log.length, did = c.checkins.length;
  const undo = c.last && log.some(d => d.date === c.last) ? `<button class="link" data-act="undo">${short(c.last)}の記録を取り消す</button>` : '';
  const missed = missedDates();
  const backfill = missed.length ? `
    <div class="backfill">
      <p class="q">記録し忘れた日</p>
      ${missed.map(d => `<div class="bf-row"><span>${dayLabel(d)}</span>
        <button class="chip" data-act="fill" data-val="${d}|1">やった</button>
        <button class="chip" data-act="fill" data-val="${d}|0">できなかった</button></div>`).join('')}
    </div>` : '';
  if (n >= ROUND) {
    return `
    <section class="card done">
      <div class="badge">${did === ROUND ? '3日達成 🎉' : `3日向き合った ・ ${did}日できた`}</div>
      <h2>${m.emoji} ${m.name}</h2>
      ${dots(log)}
      <p class="q">この3日間、気持ちよくできた？</p>
      <div class="rates">${Object.entries(RATINGS).map(([k, v]) =>
        `<button class="rate ${c.rating === k ? 'sel' : ''}" data-act="rate" data-val="${k}">${v}</button>`).join('')}</div>
      <label class="q" for="note">ひとことメモ <small>任意</small></label>
      <textarea id="note" class="note-input" rows="2" maxlength="200" placeholder="試して感じたこと、あとで振り返りたいこと">${esc(c.note || '')}</textarea>
      ${nextChoice(c, m)}
      ${undo}
    </section>`;
  }
  const rec = log.find(d => d.date === today());
  return `
  <section class="card">
    <div class="badge soft">いまのチャレンジ ・ ${CATS[m.cat]}</div>
    <h2>${m.emoji} ${m.name}</h2>
    <p class="todo">${m.todo}</p>
    ${dots(log)}
    ${rec
      ? `<button class="btn primary" disabled>${rec.done ? '今日は達成 ✓ また明日' : '今日は記録ずみ。また明日'}</button>`
      : recordedToday()
        ? `<button class="btn primary" disabled>今日は記録ずみ。また明日</button>`
        : `<button class="btn primary big" data-act="checkin">今日やった！</button>
           <button class="btn miss" data-act="miss">今日はできなかった</button>`}
    ${backfill}
    ${undo}
    ${m.tip ? `<p class="tip">💡 ${m.tip}</p>` : ''}
    <p class="muted center stay">あと${ROUND - n}日。3日向き合ったら、次の方法をためそう。<br>できなかった日も、試した結果のひとつ。</p>
  </section>`;
}

function viewHome() { return hero() + currentCard() + ongoingCard(); }

function viewCatalog() {
  const chips = [['all', 'すべて'], ...Object.entries(CATS), ...((state.custom || []).length ? [['mine', 'じぶんで追加']] : [])].map(([k, v]) =>
    `<button class="chip ${filter === k ? 'on' : ''}" data-act="filter" data-val="${k}">${v}</button>`).join('');
  const recIds = report().recs.map(m => m.id);
  const list = methods().filter(m => filter === 'all' || m.cat === filter || (filter === 'mine' && m.custom)).map(m => {
    const s = methodStats(m.id), cur = state.current && state.current.methodId === m.id, wait = cooldownUntil(m.id);
    const tag = isOngoing(m.id) ? '<em class="tag">継続中</em>'
      : cur ? '<em class="tag now">挑戦中</em>'
      : s.days ? `<em class="tag">${s.days}日やった${s.rating ? ' ' + RATINGS[s.rating].split(' ')[0] : ''}</em>`
      : recIds.includes(m.id) ? '<em class="tag rec">合いそう</em>'
      : m.custom ? '<em class="tag mine">じぶんで追加</em>' : '';
    return `
    <button class="row ${!cur && wait ? 'resting' : ''}" data-act="open" data-val="${m.id}">
      <span class="row-emoji">${m.emoji}</span>
      <span class="row-body"><b>${m.name}</b><small>${CATS[m.cat]}${!cur && wait ? ` ・ ${short(wait)}からまた選べる` : ''}</small></span>
      ${tag}
    </button>`;
  }).join('');
  return `
  <section class="page">
    <h1>ダイエット法</h1>
    <p class="muted">気になるものを3日だけ。全${methods().length}種類。一度ためした方法は、1ヶ月後にまた選べます。</p>
    <div class="chips">${chips}</div>
    <div class="list">${list}</div>
    <p class="note">どれも無理な食事制限をしない方法です。持病のある方、妊娠中・授乳中の方は、始める前に医師に相談してください。</p>
  </section>`;
}

function viewRecord() {
  const cs = days();
  const cards = Math.max(1, Math.ceil(cs.length / 30));
  let stamps = '';
  for (let k = 0; k < cards; k++) {
    let cells = '';
    for (let i = k * 30; i < k * 30 + 30; i++) {
      const c = cs[i];
      cells += c
        ? `<div class="cell ${c.done ? 'on' : 'miss'}" title="${short(c.date)} ${M(c.methodId).name}${c.done ? '' : '（できなかった）'}">${M(c.methodId).emoji}</div>`
        : `<div class="cell">${i + 1}</div>`;
    }
    stamps += `<div class="stampcard"><div class="stamp-head">${k + 1}ヶ月目のスタンプ帳<span>${Math.min(30, cs.length - k * 30)}/30</span></div><div class="grid">${cells}</div></div>`;
  }
  const hist = [...rounds()].filter(faced).reverse().map(r => {
    const m = M(r.methodId), cur = r === state.current;
    const status = cur ? '挑戦中' : r.outcome !== 'completed' ? `${r.checkins.length}日で切りかえ` : r.checkins.length >= ROUND ? '3日達成' : `3日中${r.checkins.length}日できた`;
    return `
    <div class="hist">
      <span class="row-emoji">${m.emoji}</span>
      <span class="row-body"><b>${m.name}</b><small>${short(dayLog(r)[0].date)}〜 ・ ${status}${r.rating ? ' ・ ' + RATINGS[r.rating] : ''}</small>${r.note && r.note.trim() ? `<q class="memo">${esc(r.note.trim())}</q>` : ''}</span>
    </div>`;
  }).join('');
  return `
  <section class="page">
    <h1>きろく</h1>
    <p class="muted">3マスで1つの三日坊主。10個ならべば1ヶ月。うすいマスは、できなかった日。</p>
    ${reportCard()}
    ${stamps}
    ${ongoingRecord()}
    <h3>これまでの三日坊主</h3>
    ${hist || '<p class="muted">まだ記録がありません。</p>'}
    ${bodySection()}
  </section>`;
}

function sheet() {
  if (modal) return modalSheet();
  if (!sheetId) return '';
  const m = M(sheetId), s = methodStats(m.id);
  const c = state.current, cur = c && c.methodId === m.id;
  const past = state.history.filter(r => r.methodId === m.id && r.note && r.note.trim()).reverse();
  const notes = past.length ? `<dl><dt>前にやったときのメモ</dt>${past.map(r =>
    `<dd class="memo-past"><small>${short(dayLog(r)[0].date)}〜${r.rating ? ' ・ ' + RATINGS[r.rating] : ''}</small>${esc(r.note.trim())}</dd>`).join('')}</dl>` : '';
  const left = c ? ROUND - faced(c) : 0, wait = cooldownUntil(m.id);
  const label = cur && left > 0 ? 'いま挑戦中です'
    : c && left > 0 ? `「${M(c.methodId).name}」の3日間が終わったら選べます（あと${left}日）`
    : c && !c.rating ? `先に「${M(c.methodId).name}」の感想をえらぼう`
    : isOngoing(m.id) ? 'いま継続中です'
    : wait ? `${short(wait)}からまた選べます`
    : '3日間やってみる';
  return `
  <div class="overlay" data-act="close"></div>
  <div class="sheet" role="dialog" aria-label="${m.name}">
    <div class="sheet-emoji">${m.emoji}</div>
    <h2>${m.name}</h2>
    <p class="muted center">${CATS[m.cat]}${s.days ? ` ・ これまで${s.days}日` : ''}</p>
    <dl>
      <dt>やること</dt><dd>${m.todo}</dd>
      ${m.why ? `<dt>${m.custom ? '良いと思う理由' : 'なぜ効く？'}</dt><dd>${m.why}</dd>` : ''}
      ${m.tip ? `<dt>コツ</dt><dd>${m.tip}</dd>` : ''}
    </dl>
    ${notes}
    <button class="btn primary" data-act="start" data-val="${m.id}" ${locked() || wait || isOngoing(m.id) ? 'disabled' : ''}>${label}</button>
    <button class="btn" data-act="close">とじる</button>
    <button class="link" data-act="fbAbout" data-val="${m.id}">この方法について意見を送る</button>
    ${m.custom && !rounds().some(r => r.methodId === m.id) ? `<button class="link" data-act="delMethod" data-val="${m.id}">この方法を削除する</button>` : ''}
  </div>`;
}

function render() {
  const views = { home: viewHome, catalog: viewCatalog, record: viewRecord, beta: viewBeta };
  document.getElementById('view').innerHTML = views[tab]();
  document.getElementById('tabs').innerHTML = [['home', '🏠', 'ホーム'], ['catalog', '🔍', 'さがす'], ['record', '📅', 'きろく'], ['beta', '🧪', 'β版']]
    .map(([k, i, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-val="${k}"><span>${i}</span>${l}</button>`).join('');
  document.getElementById('sheet').innerHTML = sheet();
}
