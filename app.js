/* ================================================================
   澄心 · CLEARWAVE — 应用逻辑
   测试流程 / 计分 / 解读 / 本地记录
   ================================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'clearwave_records_v1';
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    scale: null,
    answers: [],
    index: 0,
    transitioning: false,
    currentRecord: null
  };

  const toneMap = { calm: 'calm', mild: 'mild', moderate: 'moderate', high: 'high' };

  /* ---------------- 工具 ---------------- */
  function fmtDate(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function levelOf(scale, score, subscale) {
    const levels = subscale ? subscale.levels : scale.levels;
    return levels.find(l => score >= l.min && score <= l.max) || levels[levels.length - 1];
  }

  /* ---------------- 导航 ---------------- */
  function navigate(view) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-link').forEach(n => n.classList.toggle('active', n.dataset.nav === view));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'scales') renderScales();
    if (view === 'history') renderHistory();
  }

  /* ---------------- 量表列表 ---------------- */
  function renderScales() {
    const grid = $('#scaleGrid');
    grid.innerHTML = SCALES.map(s => `
      <button class="scale-card" data-theme="${s.theme}" data-id="${s.id}">
        <div class="sc-top">
          <span class="sc-code">${esc(s.code)}</span>
          <span class="sc-badge">${s.subscales ? '三维评估' : '单维评估'}</span>
        </div>
        <h3 class="sc-title">${esc(s.short)}</h3>
        <p class="sc-name">${esc(s.name)}</p>
        <p class="sc-desc">${esc(s.intro)}</p>
        <div class="sc-foot">
          <div class="sc-meta">
            <span><svg><use href="#i-clock"/></svg>${esc(s.time)}</span>
            <span><svg><use href="#i-spark"/></svg>${s.count} 题</span>
          </div>
          <span class="sc-go"><svg><use href="#i-arrow"/></svg></span>
        </div>
      </button>
    `).join('');

    $$('.scale-card', grid).forEach(card => {
      card.addEventListener('click', () => startTest(card.dataset.id));
    });
  }

  /* ---------------- 测试流程 ---------------- */
  function startTest(scaleId) {
    const scale = SCALES.find(s => s.id === scaleId);
    if (!scale) return;
    state.scale = scale;
    state.answers = new Array(scale.questions.length).fill(undefined);
    state.index = 0;
    state.transitioning = false;
    $('#testExit').dataset.returnTo = 'scales';
    renderQuestion();
    navigate('test');
  }

  function renderQuestion() {
    const s = state.scale;
    if (!s) return;
    const i = state.index;
    const total = s.questions.length;

    $('#testCode').textContent = s.code;
    $('#testName').textContent = s.name;
    $('#testStep').textContent = `${i + 1} / ${total}`;
    $('#progressFill').style.width = `${((i + 1) / total) * 100}%`;
    $('#questionPrompt').textContent = s.prompt;
    $('#questionText').textContent = s.questions[i];

    const opts = $('#options');
    opts.innerHTML = s.options.map((o, idx) => `
      <button class="option ${state.answers[i] === o.value ? 'selected' : ''}" data-value="${o.value}">
        <span class="radio"></span>
        <span>${esc(o.label)}</span>
        <span class="key">${idx + 1}</span>
      </button>
    `).join('');
    // 触发题目区入场动画
    const area = $('.question-area');
    area.style.animation = 'none';
    void area.offsetWidth;
    area.style.animation = '';

    $('#prevBtn').disabled = i === 0;
    $('#nextBtn').disabled = state.answers[i] === undefined;
    $('#nextBtn').innerHTML = (i === total - 1)
      ? '查看结果 <svg><use href="#i-arrow"/></svg>'
      : '下一题 <svg><use href="#i-arrow"/></svg>';
  }

  function selectOption(value) {
    if (state.transitioning) return;
    state.answers[state.index] = value;
    renderQuestion();
    setTimeout(advance, 300);
  }

  function advance() {
    if (state.transitioning || !state.scale) return;
    if (state.answers[state.index] === undefined) return;
    state.transitioning = true;
    if (state.index < state.scale.questions.length - 1) {
      state.index++;
      renderQuestion();
      setTimeout(() => { state.transitioning = false; }, 340);
    } else {
      finishTest();
    }
  }

  function prev() {
    if (state.index === 0 || state.transitioning) return;
    state.index--;
    renderQuestion();
  }

  /* ---------------- 计分 ---------------- */
  function scoreIndices(s, answers, indices) {
    const maxOpt = s.options.length - 1;
    return indices.reduce((sum, i) => {
      let v = answers[i] || 0;
      if (s.reverseItems && s.reverseItems.includes(i)) v = maxOpt - v;
      return sum + v;
    }, 0);
  }

  function computeResult(s, answers) {
    const base = {
      id: uid(),
      scaleId: s.id,
      scaleCode: s.code,
      scaleName: s.name,
      scaleShort: s.short,
      date: Date.now(),
      answers: answers.slice()
    };

    if (s.subscales) {
      const subs = s.subscales.map(sub => {
        const raw = scoreIndices(s, answers, sub.items.map(n => n - 1));
        const score = raw * (s.multiplier || 1);
        const level = levelOf(s, score, sub);
        return { key: sub.key, name: sub.name, desc: sub.desc, score, max: 42, level, toneColor: sub.toneColor };
      });
      // 以得分最高的维度作为概览呈现，并生成可读的结果标题
      const focus = subs.reduce((a, b) => b.score > a.score ? b : a, subs[0]);
      const titleMap = {
        '正常': '处于正常范围', '轻度': '有轻度困扰', '中度': '困扰达到中度',
        '重度': '困扰较重', '极重度': '负荷很重'
      };
      return Object.assign(base, {
        multi: true,
        score: focus.score,
        max: focus.max,
        focusName: focus.name,
        level: Object.assign({}, focus.level, {
          title: `${focus.name}维度${titleMap[focus.level.label] || focus.level.label}`
        }),
        subscales: subs
      });
    }

    const max = s.questions.length * (s.options.length - 1);
    const score = scoreIndices(s, answers, s.questions.map((_, i) => i));
    return Object.assign(base, {
      multi: false,
      score,
      max,
      level: levelOf(s, score)
    });
  }

  function finishTest() {
    const result = computeResult(state.scale, state.answers);
    saveRecord(result);
    state.currentRecord = result;
    renderResult(result, true);
    navigate('result');
    state.transitioning = false;
  }

  /* ---------------- 结果渲染 ---------------- */
  function ringSvg(score, max) {
    const C = 2 * Math.PI * 70; // 439.8
    const pct = Math.min(1, score / max);
    setTimeout(() => {
      const fill = $('#scoreFill');
      if (fill) fill.style.strokeDashoffset = String(C * (1 - pct));
    }, 120);
    return `<svg viewBox="0 0 168 168"><circle class="track" cx="84" cy="84" r="70"/><circle class="fill" id="scoreFill" cx="84" cy="84" r="70" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`;
  }

  function renderResult(rec, justFinished) {
    const s = SCALES.find(x => x.id === rec.scaleId);
    if (!s) return;
    state.currentRecord = rec;
    const tone = toneMap[rec.level.tone] || 'mild';
    const shell = $('#resultShell');

    // 危机提示：PHQ-9 第 9 题非零
    let alertHtml = '';
    if (s.alert && rec.answers && rec.answers[s.alert.itemIndex] > 0) {
      alertHtml = `
        <div class="result-alert reveal">
          <div class="ra-icon"><svg><use href="#i-heart"/></svg></div>
          <div><h3>${esc(s.alert.title)}</h3><p>${esc(s.alert.text)}</p></div>
        </div>`;
    }

    // DASS 三维详情
    let subHtml = '';
    if (rec.multi && rec.subscales) {
      subHtml = `
        <div class="result-card reveal">
          <h2><span class="accent-line"></span>三个维度，分别来看</h2>
          ${rec.subscales.map(sub => `
            <div class="subscale-block">
              <div class="ss-head">
                <span class="ss-name">${esc(sub.name)}<span class="ss-desc">${esc(sub.desc)}</span></span>
                <span class="ss-score" style="color:${sub.toneColor}">${sub.score} <small style="font-size:11px;color:var(--ink-3)">/ ${sub.max}</small> · ${esc(sub.level.label)}</span>
              </div>
              <div class="ss-bar"><div class="ss-fill" data-w="${Math.min(100, (sub.score / sub.max) * 100)}" style="background:${sub.toneColor}"></div></div>
              <div class="ss-level">${esc(sub.level.text)}</div>
            </div>`).join('')}
        </div>`;
    }

    // 趋势图（同一量表 ≥2 次记录）
    const trendHtml = buildTrend(rec.scaleId, rec.id);

    shell.innerHTML = `
      <div class="result-hero ${tone} reveal">
        <div class="score-ring">
          ${ringSvg(rec.score, rec.max)}
          <div class="score-center">
            <div class="score-num">${rec.score}</div>
            <div class="score-den">/ ${rec.max}${rec.focusName ? ' · ' + esc(rec.focusName) : ''}</div>
          </div>
        </div>
        <div class="result-hero-text">
          <div class="r-code">${esc(rec.scaleCode)} · 测评结果</div>
          <h1>${esc(rec.level.title || rec.level.label)}</h1>
          <span class="level-chip"><span class="cdot"></span>${esc(rec.level.label)}</span>
          <div class="result-date">完成于 ${fmtDate(rec.date)} ${justFinished ? '· 已自动保存到记录' : '· 来自历史记录'}</div>
        </div>
      </div>

      ${alertHtml}

      <div class="result-card reveal">
        <h2><span class="accent-line"></span>这份结果意味着什么</h2>
        <p>${esc(rec.level.text)}</p>
      </div>

      ${subHtml}
      ${trendHtml}

      <div class="result-card reveal">
        <h2><span class="accent-line"></span>接下来可以做什么</h2>
        <div class="suggest-list">
          ${s.suggestions.map((sg, i) => `
            <div class="suggest-item">
              <span class="suggest-num">${String(i + 1).padStart(2, '0')}</span>
              <div><h4>${esc(sg.title)}</h4><p>${esc(sg.body)}</p></div>
            </div>`).join('')}
        </div>
      </div>

      <div class="result-actions reveal">
        <button class="btn btn-primary" data-action="retest">再测一次 <svg><use href="#i-arrow"/></svg></button>
        <button class="btn btn-ghost" data-action="history"><svg><use href="#i-chart"/></svg> 看看历史记录</button>
        <button class="btn btn-ghost" data-nav="home">回到首页</button>
      </div>
      <p class="result-footnote">📌 这份结果用于自我了解，不构成医学诊断，也不能替代专业评估。<br>如果困扰持续或加重，请考虑寻求心理咨询师或精神科医生的帮助。</p>
    `;

    // 条形动画
    setTimeout(() => {
      $$('.ss-fill', shell).forEach(f => { f.style.width = f.dataset.w + '%'; });
    }, 200);

    $$('[data-action="retest"]', shell).forEach(b => b.addEventListener('click', () => startTest(rec.scaleId)));
    $$('[data-action="history"]', shell).forEach(b => b.addEventListener('click', () => navigate('history')));
  }

  function buildTrend(scaleId, currentId) {
    const recs = getRecords().filter(r => r.scaleId === scaleId).slice(0, 8).reverse();
    if (recs.length < 2) return '';
    const W = 680, H = 160, PL = 34, PR = 20, PT = 22, PB = 34;
    const iw = W - PL - PR, ih = H - PT - PB;
    const pts = recs.map((r, i) => ({
      x: PL + (recs.length === 1 ? iw / 2 : i * iw / (recs.length - 1)),
      y: PT + ih - (Math.min(r.score, r.max) / r.max) * ih,
      r
    }));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${PT + ih} L${pts[0].x.toFixed(1)},${PT + ih} Z`;
    const dots = pts.map(p => {
      const isCurrent = p.r.id === currentId;
      const d = new Date(p.r.date);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isCurrent ? 5.5 : 4}" fill="${isCurrent ? '#1d506e' : '#93c2d3'}" stroke="#fff" stroke-width="2"/>
              <text x="${p.x.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#7d98a6" font-family="var(--font-body)">${label}</text>`;
    }).join('');
    return `
      <div class="result-card reveal">
        <h2><span class="accent-line"></span>你的变化轨迹</h2>
        <p style="font-size:13px;color:var(--ink-3);margin-bottom:14px">同一量表的历次得分（纵轴为分数，越低越靠近底部）。波动是正常的，看长期趋势就好。</p>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible">
          <defs><linearGradient id="trendG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#93c2d3" stop-opacity=".45"/><stop offset="100%" stop-color="#93c2d3" stop-opacity="0"/>
          </linearGradient></defs>
          <line x1="${PL}" y1="${PT + ih}" x2="${W - PR}" y2="${PT + ih}" stroke="#d6e5ec" stroke-width="1"/>
          <path d="${area}" fill="url(#trendG)"/>
          <path d="${line}" fill="none" stroke="#5f9fb8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          ${dots}
        </svg>
      </div>`;
  }

  /* ---------------- 本地记录 ---------------- */
  function getRecords() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  }

  function saveRecord(rec) {
    const recs = getRecords();
    recs.unshift(rec);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recs.slice(0, 100))); }
    catch (e) { /* 隐私模式或存储已满时静默降级 */ }
  }

  function renderHistory() {
    const list = $('#historyList');
    const toolbar = $('#historyToolbar');
    const recs = getRecords();

    if (!recs.length) {
      toolbar.innerHTML = '';
      list.innerHTML = `
        <div class="empty">
          <svg><use href="#i-wave"/></svg>
          <h3>这里还很安静</h3>
          <p>完成第一次自评后，记录会留在这里，陪你看见自己的变化。</p>
          <button class="btn btn-primary" data-nav="scales">去做一次自评 <svg><use href="#i-arrow"/></svg></button>
        </div>`;
      bindNav(list);
      return;
    }

    toolbar.innerHTML = `
      <div class="history-stat"><b>${recs.length}</b> 条记录</div>
      <button class="btn btn-danger" id="clearAll">清空全部记录</button>`;

    list.innerHTML = recs.map(r => {
      const tone = toneMap[r.level.tone] || 'mild';
      const s = SCALES.find(x => x.id === r.scaleId) || { theme: 'sea' };
      const subLine = r.multi && r.subscales
        ? r.subscales.map(x => `${x.name} ${x.score}`).join(' · ')
        : `${r.score} / ${r.max} 分`;
      return `
        <div class="history-item" data-theme="${s.theme}">
          <div class="hi-symbol"><svg><use href="#i-wave"/></svg></div>
          <div class="hi-main">
            <h3 class="hi-title">${esc(r.scaleShort)} <span style="font-size:12px;color:var(--ink-3);font-family:var(--font-body);font-weight:400">${esc(r.scaleCode)}</span></h3>
            <div class="hi-sub"><span>${fmtDate(r.date)}</span><span>${esc(subLine)}</span></div>
          </div>
          <div class="hi-right">
            <span class="hi-chip ${tone}">${esc(r.level.label)}</span>
            <button class="btn btn-ghost" style="padding:9px 16px;font-size:12.5px" data-view="${r.id}">查看解读</button>
            <button class="hi-del" data-del="${r.id}" aria-label="删除这条记录"><svg><use href="#i-trash"/></svg></button>
          </div>
        </div>`;
    }).join('');

    $$('[data-view]', list).forEach(b => b.addEventListener('click', () => {
      const rec = getRecords().find(r => r.id === b.dataset.view);
      if (rec) { renderResult(rec, false); navigate('result'); }
    }));
    $$('[data-del]', list).forEach(b => b.addEventListener('click', () => {
      if (!window.confirm('确定删除这条记录吗？此操作不可撤销。')) return;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(getRecords().filter(r => r.id !== b.dataset.del))); }
      catch (e) {}
      renderHistory();
    }));
    const clear = $('#clearAll');
    if (clear) clear.addEventListener('click', () => {
      if (!window.confirm('确定清空全部记录吗？此操作不可撤销。')) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      renderHistory();
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindNav(root) {
    $$('[data-nav]', root).forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      navigate(b.dataset.nav);
    }));
  }

  function init() {
    bindNav(document);

    $('#prevBtn').addEventListener('click', prev);
    $('#nextBtn').addEventListener('click', advance);
    $('#testExit').addEventListener('click', () => navigate('scales'));

    $('#options').addEventListener('click', e => {
      const btn = e.target.closest('.option');
      if (btn) selectOption(Number(btn.dataset.value));
    });

    document.addEventListener('keydown', e => {
      if (!$('#view-test').classList.contains('active') || !state.scale) return;
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < state.scale.options.length) selectOption(state.scale.options[idx].value);
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault(); advance();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); prev();
      }
    });

    renderScales();
  }

  init();
})();
