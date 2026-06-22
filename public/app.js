const $ = (id) => document.getElementById(id);

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
  el.innerHTML = `
    <div class="card-head">
      <span class="badge" style="background:${g.bg};color:${g.color}">${g.label}</span>
      <span class="card-loc">${esc(job.location)}</span>
    </div>
    <h2 class="card-title"><a href="${url}" target="_blank">${esc(job.position)}</a></h2>
    <p class="card-company">${esc(job.companyName)}</p>
    <p class="card-summary">${esc(job.summary)}</p>
    <div class="card-foot"><span class="score-pill">${job.score}점</span>
      <div class="card-tags">${tags}${gaps}</div></div>`;
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
}

function handleChunk(chunk) {
  const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return;
  let e;
  try { e = JSON.parse(dataLine.slice(6)); } catch { return; }
  if (e.type === 'status') setStatus(e.message);
  else if (e.type === 'scored') { addCard(e.job); setStatus(`채점 중 ${e.index}/${e.total}`); setProgress(e.index, e.total); }
  else if (e.type === 'done') { sortCards(); setStatus(`완료 — ${e.count}개 공고`); setProgress(1, 1); }
  else if (e.type === 'error') showError(e.message);
}

async function run() {
  const resume = $('resume').value.trim();
  if (!resume) { showError('이력서를 입력하세요.'); return; }

  $('errorBar').hidden = true;
  $('results').innerHTML = '';
  $('statusBar').hidden = false;
  setProgress(0, 1);
  setRunning(true);

  try {
    const res = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume, limit: Number($('limit').value) }),
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
    showError(String(err?.message ?? err));
  } finally {
    setRunning(false);
  }
}

$('runBtn').addEventListener('click', run);
