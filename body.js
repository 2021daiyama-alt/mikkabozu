// からだの記録（体重・体脂肪率）。
// 方針：入力は任意。日ごとの折れ線と、ならした線をいつも一緒に見せる（ならした線は消せない）。
// 3日のダイエット法とは結びつけない（グラフに方法名や区切りを重ねない）。運営には送らない。
const BODY = {
  w: { label: '体重', unit: 'kg', min: 20, max: 300 },
  f: { label: '体脂肪率', unit: '%', min: 1, max: 70 },
};
const RANGES = [['30', '1ヶ月'], ['90', '3ヶ月'], ['0', 'すべて']];
const CW = 340, CH = 170; // グラフの座標系
const chartPts = {};

function bodyRows() { return [...(state.body || [])].sort((a, b) => a.date.localeCompare(b.date)); }
function dnum(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; }

// ならした線は、その日を含む直近7日間にある記録の平均。
// ただし7日間の記録が3回に満たないとき（たまにしか測らない人）は、直近3回の記録の平均にする。
// 表示期間より前の記録も平均には使う。
function series(key, days) {
  const all = bodyRows().filter(r => r[key] != null).map(r => ({ date: r.date, t: dnum(r.date), v: r[key] }));
  all.forEach((p, i) => {
    let win = all.filter(q => q.t <= p.t && q.t > p.t - 7);
    if (win.length < 3) win = all.slice(Math.max(0, i - 2), i + 1);
    p.a = win.reduce((s, q) => s + q.v, 0) / win.length;
  });
  const from = days ? dnum(today()) - days + 1 : -Infinity;
  return all.filter(p => p.t >= from);
}

function chart(key, days) {
  const pts = series(key, days), b = BODY[key];
  const head = `<h4>${b.label}<small>${b.unit}</small></h4>`;
  if (pts.length < 2) {
    return `<div class="chart empty">${head}<p class="muted">${pts.length
      ? `この期間の記録は1回（${pts[0].v.toFixed(1)}${b.unit}）。2回以上でグラフが出ます。`
      : 'この期間の記録はまだありません。'}</p></div>`;
  }
  const L = 36, R = 46, T = 12, B = 24;
  const t1 = Math.max(dnum(today()), pts[pts.length - 1].t);
  const t0 = pts[0].t; // 記録のある最初の日から描く（期間の前半が空白にならないように）
  const vals = pts.flatMap(p => [p.v, p.a]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 0.5);
  lo -= pad; hi += pad;
  const x = t => L + (t - t0) / Math.max(t1 - t0, 1) * (CW - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (CH - T - B);
  const P = pts.map(p => ({ ...p, x: x(p.t), y: y(p.v), ya: y(p.a) }));
  chartPts[key] = P;
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const last = P[P.length - 1];
  const f1 = n => n.toFixed(1);
  const dateOf = t => { const d = new Date(t * 864e5); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  return `
  <div class="chart" data-chart="${key}">
    ${head}
    <svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${b.label}の推移。最新のならした値は${f1(last.a)}${b.unit}">
      ${ticks.map(v => `<line class="grid" x1="${L}" x2="${CW - R}" y1="${f1(y(v))}" y2="${f1(y(v))}"/><text class="axis" x="${L - 6}" y="${f1(y(v) + 3.5)}" text-anchor="end">${f1(v)}</text>`).join('')}
      <text class="axis" x="${L}" y="${CH - 6}">${dateOf(t0)}</text>
      <text class="axis" x="${CW - R}" y="${CH - 6}" text-anchor="end">${dateOf(t1)}</text>
      <line class="cross" y1="${T}" y2="${CH - B}" style="display:none"/>
      <polyline class="daily" points="${P.map(p => `${f1(p.x)},${f1(p.y)}`).join(' ')}"/>
      ${P.map(p => `<circle class="daily-dot" cx="${f1(p.x)}" cy="${f1(p.y)}" r="3"/>`).join('')}
      <polyline class="avg" points="${P.map(p => `${f1(p.x)},${f1(p.ya)}`).join(' ')}"/>
      <circle class="avg-dot" cx="${f1(last.x)}" cy="${f1(last.ya)}" r="4.5"/>
      <text class="end" x="${f1(last.x + 9)}" y="${f1(last.ya + 4)}">${f1(last.a)}</text>
    </svg>
    <div class="tip-box" hidden></div>
  </div>`;
}

// グラフをなぞる・タップすると、その日の記録とならした値を出す
function chartHover(e) {
  const box = e.target.closest ? e.target.closest('[data-chart]') : null;
  document.querySelectorAll('[data-chart]').forEach(c => {
    if (c !== box) { c.querySelector('.tip-box').hidden = true; c.querySelector('.cross').style.display = 'none'; }
  });
  if (!box) return;
  const key = box.dataset.chart, svg = box.querySelector('svg'), r = svg.getBoundingClientRect(), u = BODY[key].unit;
  const px = (e.clientX - r.left) / r.width * CW;
  const p = chartPts[key].reduce((a, c) => (Math.abs(c.x - px) < Math.abs(a.x - px) ? c : a));
  const cross = svg.querySelector('.cross');
  cross.setAttribute('x1', p.x); cross.setAttribute('x2', p.x); cross.style.display = '';
  const tip = box.querySelector('.tip-box');
  tip.innerHTML = `<b>${short(p.date)}</b><span>ならした値 <b>${p.a.toFixed(1)}</b>${u}</span><span>この日の記録 ${p.v.toFixed(1)}${u}</span>`;
  tip.style.left = Math.min(78, Math.max(22, p.x / CW * 100)) + '%';
  tip.hidden = false;
}
document.addEventListener('pointermove', chartHover);
document.addEventListener('pointerdown', chartHover);

Object.assign(actions, {
  addBody: () => {
    const date = draft.bDate || today();
    const num = k => { const s = String(draft[k] || '').trim().replace(',', '.'); return s === '' ? null : Math.round(parseFloat(s) * 10) / 10; };
    const w = num('bW'), f = num('bF');
    if (w === null && f === null) { toast('体重か体脂肪率の、どちらかを入れてください'); return; }
    if (date > today()) { toast('先の日付は記録できません'); return; }
    for (const [k, v] of [['w', w], ['f', f]]) {
      if (v !== null && !(v >= BODY[k].min && v <= BODY[k].max)) { toast(`${BODY[k].label}の数字を確かめてください`); return; }
    }
    const rows = state.body || (state.body = []);
    let row = rows.find(r => r.date === date);
    if (!row) { row = { date }; rows.push(row); }
    if (w !== null) row.w = w;
    if (f !== null) row.f = f;
    draft.bW = draft.bF = ''; draft.bDate = '';
    toast(`${short(date)}の記録を残しました`);
  },
  delBody: date => { state.body = (state.body || []).filter(r => r.date !== date); },
  bodyRange: v => { draft.bRange = v; },
});

function bodySection() {
  const rows = bodyRows(), days = +(draft.bRange || '90');
  const d = k => esc(draft[k] || '');
  const list = [...rows].reverse().map(r => `
    <li><span>${short(r.date)}</span><span>${r.w != null ? r.w.toFixed(1) + ' kg' : '—'}</span><span>${r.f != null ? r.f.toFixed(1) + ' %' : '—'}</span>
    <button class="link" data-act="delBody" data-val="${r.date}">消す</button></li>`).join('');
  return `
  <h3>からだの記録</h3>
  <p class="muted">体重と体脂肪率を、気が向いたときに残せます。毎日でなくて大丈夫。どちらか片方だけでも残せます。</p>
  <div class="bodyform">
    <label class="f">日付<input class="field" type="date" data-draft="bDate" max="${today()}" value="${draft.bDate || today()}"></label>
    <label class="f">体重 <small>kg</small><input class="field" type="number" inputmode="decimal" step="0.1" data-draft="bW" placeholder="例 62.4" value="${d('bW')}"></label>
    <label class="f">体脂肪率 <small>%</small><input class="field" type="number" inputmode="decimal" step="0.1" data-draft="bF" placeholder="例 24.5" value="${d('bF')}"></label>
  </div>
  <button class="btn primary" data-act="addBody">記録する</button>
  ${rows.length ? `
  <div class="chips">${RANGES.map(([k, v]) => `<button class="chip ${String(days) === k ? 'on' : ''}" data-act="bodyRange" data-val="${k}">${v}</button>`).join('')}</div>
  <div class="legend">
    <span><svg width="26" height="10" aria-hidden="true"><line class="avg" x1="2" x2="24" y1="5" y2="5"/></svg>ならした線</span>
    <span><svg width="26" height="10" aria-hidden="true"><line class="daily" x1="2" x2="24" y1="5" y2="5"/><circle class="daily-dot" cx="13" cy="5" r="3"/></svg>日ごとの記録</span>
  </div>
  ${chart('w', days)}
  ${chart('f', days)}
  <p class="note">日ごとの数字は、水分や食事の時間で上下します。太い線（数回分をならした線）の流れを見てください。3日ごとのダイエット法の効果を表すものではありません。</p>
  <details class="bodylist"><summary>記録の一覧（${rows.length}件）</summary><ul>${list}</ul></details>` : ''}`;
}
