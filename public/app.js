const $ = (id) => document.getElementById(id);
let resumeHash = null;
const selectedTags = new Set();
let runStartedAt = 0;
let runController = null;

const LS = { resume: 'wm.resume', query: 'wm.query', tags: 'wm.tagIds', limit: 'wm.limit' };

function savePrefs() {
  try {
    localStorage.setItem(LS.query, $('queryText').value);
    localStorage.setItem(LS.tags, JSON.stringify([...selectedTags]));
    localStorage.setItem(LS.limit, $('limit').value);
  } catch { /* localStorage 불가 환경 무시 */ }
}
function restorePrefs() {
  try {
    const r = localStorage.getItem(LS.resume); if (r) $('resume').value = r;
    const q = localStorage.getItem(LS.query); if (q) $('queryText').value = q;
    const l = localStorage.getItem(LS.limit); if (l) $('limit').value = l;
  } catch { /* 무시 */ }
}
function restoreSelectedTags() {
  // 칩 렌더 후 호출: 저장된 tagIds로 selectedTags·.selected 복원
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(LS.tags) || '[]'); } catch { saved = []; }
  if (!Array.isArray(saved)) return;
  for (const id of saved) {
    selectedTags.add(id);
    const chip = $('tagChips').querySelector(`.chip[data-id="${id}"]`);
    if (chip) chip.classList.add('selected');
  }
}

const EST_SEC_PER_JOB = 15; // 대략치(gemma 12b). ETA는 실행 중 경과시간으로 자동 보정.
function updateLimitHint() {
  const n = Number($('limit').value) || 0;
  const mins = Math.max(1, Math.ceil((n * EST_SEC_PER_JOB) / 60));
  $('limitHint').textContent = n > 0 ? `약 ${mins}분 예상` : '';
}

async function loadTags() {
  try {
    const res = await fetch('/tags');
    const { tags } = await res.json();
    const root = $('tagChips');
    for (const t of tags) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'chip';
      el.textContent = t.label;
      el.dataset.id = t.id;
      el.addEventListener('click', () => {
        if (selectedTags.has(t.id)) { selectedTags.delete(t.id); el.classList.remove('selected'); }
        else { selectedTags.add(t.id); el.classList.add('selected'); }
      });
      root.appendChild(el);
    }
    restoreSelectedTags();
  } catch (err) {
    const root = $('tagChips');
    root.innerHTML = '<span class="chips-error">직군 목록을 불러오지 못했습니다. <button type="button" id="retryTags" class="link-btn">재시도</button></span>';
    root.querySelector('#retryTags').addEventListener('click', () => { root.innerHTML = ''; loadTags(); });
  }
}
loadTags();

let resumeSaveTimer;
$('resume').addEventListener('input', () => {
  clearTimeout(resumeSaveTimer);
  resumeSaveTimer = setTimeout(() => {
    try { localStorage.setItem(LS.resume, $('resume').value); } catch {}
  }, 400);
});
$('limit').addEventListener('input', updateLimitHint);
restorePrefs();
updateLimitHint();

function gradeBadge(score) {
  if (score >= 80) return { label: '강력 추천', color: '#065f46', bg: '#d1fae5' };
  if (score >= 65) return { label: '검토 추천', color: '#92400e', bg: '#fef3c7' };
  if (score >= 50) return { label: '참고 가능', color: '#1e3a8a', bg: '#dbeafe' };
  return { label: '낮은 핏', color: '#6b7280', bg: '#f3f4f6' };
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addCard(job) {
  const g = gradeBadge(job.score);
  const url = `https://www.wanted.co.kr/wd/${encodeURIComponent(job.id)}`;
  const tags = (job.matchPoints || []).map((p) => `<span class="tag">${esc(p)}</span>`).join('');
  const gaps = (job.gaps || []).map((p) => `<span class="tag gap">${esc(p)}</span>`).join('');
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.score = job.score;
  el.dataset.id = job.id;
  el.innerHTML = `
    <div class="card-head">
      <span class="badge" style="background:${g.bg};color:${g.color}">${g.label}</span>
      <span class="card-loc">${esc(job.location)}</span>
    </div>
    <h2 class="card-title"><a href="${url}" target="_blank">${esc(job.position)}</a></h2>
    <p class="card-company">${esc(job.companyName)}</p>
    <p class="card-summary">${esc(job.summary)}</p>
    <div class="card-foot"><span class="score-pill">${job.score}점</span>
      <div class="card-tags">${tags}${gaps}</div>
      <label class="seen-toggle"><input type="checkbox" class="seen-box" /> 확인함</label>
    </div>`;
  el.querySelector('.seen-box').addEventListener('change', (ev) =>
    onSeenToggle(job.id, el, ev.target.checked));
  $('results').appendChild(el);
}

function sortCards() {
  const cards = [...document.querySelectorAll('.card')];
  cards.sort((a, b) => Number(b.dataset.score) - Number(a.dataset.score));
  const root = $('results');
  cards.forEach((c) => root.appendChild(c));
}

function setStatus(text) { $('statusText').textContent = text; }
function setProgress(index, total) {
  $('progressFill').style.width = total ? `${(index / total) * 100}%` : '0';
}
function showError(msg) {
  const bar = $('errorBar');
  bar.textContent = '⚠️ ' + msg;
  bar.hidden = false;
}
function setRunning(on) {
  $('runBtn').disabled = on;
  $('runBtn').textContent = on ? '분석 중...' : '분석 시작';
  $('cancelBtn').hidden = !on;
}
function friendlyError(err) {
  const msg = String(err?.message ?? err);
  if (/Unexpected token|<!DOCTYPE|is not valid JSON/i.test(msg))
    return '서버 응답이 올바르지 않습니다. 서버를 재시작했는지 확인하세요(옛 서버가 떠 있을 수 있습니다).';
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg))
    return '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.';
  return msg;
}
function showEmpty(html) {
  const el = $('emptyState');
  el.innerHTML = html;
  el.hidden = false;
}
function hideEmpty() { $('emptyState').hidden = true; }

async function onSeenToggle(jobId, cardEl, checked) {
  cardEl.classList.toggle('seen', checked);
  if (!resumeHash) return;
  try {
    await fetch('/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeHash, jobId, seen: checked }),
    });
  } catch (err) {
    showError('확인함 저장 실패: ' + String(err?.message ?? err));
  }
}

async function resetSeen() {
  if (!resumeHash) return;
  try {
    await fetch('/seen/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeHash }),
    });
    document.querySelectorAll('.card.seen').forEach((c) => c.classList.remove('seen'));
    document.querySelectorAll('.seen-box').forEach((b) => (b.checked = false));
  } catch (err) {
    showError('초기화 실패: ' + String(err?.message ?? err));
  }
}

function handleChunk(chunk) {
  const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return;
  let e;
  try { e = JSON.parse(dataLine.slice(6)); } catch { return; }
  if (e.type === 'status') setStatus(e.message);
  else if (e.type === 'scored') {
    addCard(e.job);
    setProgress(e.index, e.total);
    const elapsed = (Date.now() - runStartedAt) / 1000;
    const remain = e.index > 0 ? Math.ceil((elapsed / e.index) * (e.total - e.index) / 60) : 0;
    setStatus(remain > 0 ? `채점 중 ${e.index}/${e.total} · 약 ${remain}분 남음` : `채점 중 ${e.index}/${e.total}`);
  }
  else if (e.type === 'done') {
    resumeHash = e.resumeHash ?? null;
    sortCards();
    setProgress(1, 1);
    $('resultsBar').hidden = !resumeHash;
    if (e.count === 0) {
      setStatus('완료 — 0개');
      showEmpty('조건에 맞는 신입 공고를 찾지 못했어요.<br>· 키워드를 줄이거나 빼보세요<br>· 다른 직군 칩을 선택해보세요<br>· 공고 수를 늘려보세요');
    } else {
      setStatus(`완료 — ${e.count}개 공고`);
    }
  }
  else if (e.type === 'error') showError(e.message);
}

async function run() {
  const resume = $('resume').value.trim();
  if (!resume) { showError('이력서를 입력하세요.'); return; }
  const queryText = $('queryText').value.trim();
  if (!queryText && selectedTags.size === 0) {
    showError('검색어를 입력하거나 직군을 하나 이상 선택하세요.');
    return;
  }

  savePrefs();
  $('errorBar').hidden = true;
  $('results').innerHTML = '';
  hideEmpty();
  $('resultsBar').hidden = true;
  $('statusBar').hidden = false;
  setProgress(0, 1);
  setRunning(true);
  runStartedAt = Date.now();
  runController = new AbortController();

  try {
    const res = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume, limit: Number($('limit').value), queryText, tagIds: [...selectedTags] }),
      signal: runController.signal,
    });
    if (res.status === 409) { showError('이미 실행 중입니다. 잠시 후 다시 시도하세요.'); return; }
    if (res.status === 400) { showError((await res.json()).error); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        handleChunk(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') setStatus('중단됨');
    else showError(friendlyError(err));
  } finally {
    setRunning(false);
    runController = null;
  }
}

$('runBtn').addEventListener('click', run);
$('resetSeenBtn').addEventListener('click', resetSeen);
$('cancelBtn').addEventListener('click', () => { if (runController) runController.abort(); });
