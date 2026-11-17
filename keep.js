// 気持ちよくできた方法を「続けている習慣」として持ちながら、新しい3日のお試しへ進む仕組み。
// 決めごと：しんどかった方法は続けられない／同時に3つまで／記録は任意／できた日の累計には数えない／
//           やめたら1ヶ月は選べない／1ヶ月ごとに「まだ続ける？」と聞く／主役は新しい3日のお試し。
const KEEP_MAX = 3;
const REVIEW = 30;

function ongoing() { return state.ongoing || (state.ongoing = []); }
function isOngoing(id) { return (state.ongoing || []).some(o => o.methodId === id); }
function stopOngoing(id) {
  state.ongoing = ongoing().filter(o => o.methodId !== id);
  (state.stopped || (state.stopped = {}))[id] = today(); // やめた日。ここから1ヶ月は選べない
}
function doKeep() {
  const c = state.current;
  c.kept = true; // 相性レポートで「続けたいと思えた」手がかりとして使う
  ongoing().push({ methodId: c.methodId, since: today(), log: [], reviewAt: addDays(today(), REVIEW) });
  draft.swap = false;
  archive(); tab = 'catalog';
}
function canKeep() { const c = state.current; return !!c && !locked() && c.rating !== 'bad'; }

Object.assign(actions, {
  keep: () => {
    if (!canKeep()) return;
    if (ongoing().length >= KEEP_MAX) { draft.swap = true; return; }
    doKeep();
  },
  swapOut: id => { if (!canKeep() || !isOngoing(id)) return; stopOngoing(id); doKeep(); },
  cancelSwap: () => { draft.swap = false; },
  // 今日できた／取り消しの切りかえ。新しい3日のお試しをしている間だけ記録できる。
  og: id => {
    const o = ongoing().find(x => x.methodId === id);
    if (!o || !state.current) return;
    const t = today();
    o.log = o.log.includes(t) ? o.log.filter(d => d !== t) : [...o.log, t];
  },
  ogStop: id => {
    if (draft.stopArm !== id) { draft.stopArm = id; return; }
    draft.stopArm = null; stopOngoing(id);
  },
  ogKeep: id => { const o = ongoing().find(x => x.methodId === id); if (o) o.reviewAt = addDays(today(), REVIEW); },
});

function ogDays(o) { return dnum(today()) - dnum(o.since) + 1; }

// 3日後のカードに出す「次はどうする？」
function nextChoice(c, m) {
  if (draft.swap && canKeep()) {
    return `
      <p class="q">続けている習慣は${KEEP_MAX}つまで。どれかと入れかえますか？</p>
      ${ongoing().map(o => `<button class="btn" data-act="swapOut" data-val="${o.methodId}">「${M(o.methodId).name}」をやめて入れかえる</button>`).join('')}
      <button class="link" data-act="cancelSwap">入れかえない</button>`;
  }
  const off = c.rating ? '' : 'disabled';
  const until = short(addDays(dayLog(c).map(d => d.date).sort().pop(), COOLDOWN));
  const msg = !c.rating ? '先に、やってみた感じをえらんでください。'
    : c.rating === 'bad' ? `しんどかった方法は、いったん手放そう。「${m.name}」は1ヶ月後（${until}）からまた選べます。`
    : `続けない場合、「${m.name}」は1ヶ月後（${until}）からまた選べます。`;
  return `
      <p class="q">次の3日間は、別の方法をためそう</p>
      <button class="btn primary" data-act="switch" ${off}>別のダイエット法をためす</button>
      ${c.rating !== 'bad' ? `<button class="btn" data-act="keep" ${off}>この方法を継続しながら別のダイエット法もためす</button>` : ''}
      <p class="muted center">${msg}</p>`;
}

// ホーム：続けている習慣のチェック欄
function ongoingCard() {
  const list = ongoing();
  if (!list.length) return '';
  const t = today();
  return `
  <section class="card og">
    <div class="badge">続けている習慣 ${list.length}/${KEEP_MAX}</div>
    ${list.map(o => {
      const m = M(o.methodId), done = o.log.includes(t), armed = draft.stopArm === o.methodId;
      const stop = `<button class="${t >= o.reviewAt ? 'chip' : 'link og-stop'}" data-act="ogStop" data-val="${o.methodId}">${armed ? 'もう一度押すとやめる' : 'やめる'}</button>`;
      return `
      <div class="og-row">
        <span class="row-emoji">${m.emoji}</span>
        <span class="row-body"><b>${m.name}</b><small>続けて${ogDays(o)}日目</small></span>
        <button class="chip check ${done ? 'on' : ''}" data-act="og" data-val="${o.methodId}" ${state.current ? '' : 'disabled'}>${done ? '✓ 今日できた' : '今日できた'}</button>
      </div>
      ${t >= o.reviewAt
        ? `<div class="og-review"><span>続けて1ヶ月。まだ続ける？</span><button class="chip" data-act="ogKeep" data-val="${o.methodId}">続ける</button>${stop}</div>`
        : stop}`;
    }).join('')}
    <p class="muted center">${state.current ? 'こちらの記録は任意です。押さなくても先に進めます。' : '新しい3日を始めると、こちらも記録できます。'}</p>
  </section>`;
}

// きろく：続けている習慣の一覧
function ongoingRecord() {
  const list = ongoing();
  if (!list.length) return '';
  return `
    <h3>続けている習慣</h3>
    ${list.map(o => { const m = M(o.methodId); return `
    <div class="hist">
      <span class="row-emoji">${m.emoji}</span>
      <span class="row-body"><b>${m.name}</b><small>${short(o.since)}から ・ 続けて${ogDays(o)}日目 ・ 記録${o.log.length}回</small></span>
    </div>`; }).join('')}`;
}
