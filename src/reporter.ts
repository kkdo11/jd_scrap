import { ScoredJob } from './types';
import * as fs from 'fs';

function scoreGrade(score: number): { color: string; bg: string; label: string } {
  if (score >= 80) return { color: '#065f46', bg: '#d1fae5', label: '강력 추천' };
  if (score >= 65) return { color: '#92400e', bg: '#fef3c7', label: '검토 추천' };
  if (score >= 50) return { color: '#1e3a8a', bg: '#dbeafe', label: '참고 가능' };
  return { color: '#6b7280', bg: '#f3f4f6', label: '낮은 핏' };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jobCard(job: ScoredJob, index: number): string {
  const grade = scoreGrade(job.score);
  const url = `https://www.wanted.co.kr/wd/${job.id}`;
  const matchHtml = job.matchPoints
    .map((p) => `<li><span class="dot green"></span>${escapeHtml(p)}</li>`)
    .join('');
  const gapHtml = job.gaps
    .map((g) => `<li><span class="dot amber"></span>${escapeHtml(g)}</li>`)
    .join('');

  return `
  <article class="card" data-score="${job.score}" style="animation-delay:${index * 40}ms">
    <div class="card-top" onclick="toggleCard(this)">
      <div class="card-meta">
        <span class="badge" style="background:${grade.bg};color:${grade.color}">${grade.label}</span>
        <span class="location">${escapeHtml(job.location)}</span>
      </div>
      <h2 class="card-title">
        <a href="${url}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(job.position)}</a>
      </h2>
      <p class="card-company">${escapeHtml(job.companyName)}</p>
      <p class="card-summary">${escapeHtml(job.summary)}</p>
      <div class="card-footer-row">
        <div class="score-ring">
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" stroke="#e5e7eb" stroke-width="4"/>
            <circle cx="20" cy="20" r="16" fill="none" stroke="${grade.color}" stroke-width="4"
              stroke-dasharray="${(job.score / 100) * 100.5} 100.5"
              stroke-linecap="round"
              transform="rotate(-90 20 20)"/>
          </svg>
          <span class="score-num" style="color:${grade.color}">${job.score}</span>
        </div>
        <span class="toggle-hint">상세 보기 ↓</span>
      </div>
    </div>
    <div class="card-detail">
      <div class="detail-grid">
        <div>
          <h4 class="detail-heading green-text">✓ 매칭 포인트</h4>
          <ul class="detail-list">${matchHtml || '<li><span class="dot gray"></span>정보 없음</li>'}</ul>
        </div>
        <div>
          <h4 class="detail-heading amber-text">△ 보완 필요</h4>
          <ul class="detail-list">${gapHtml || '<li><span class="dot gray"></span>없음</li>'}</ul>
        </div>
      </div>
      <a class="apply-link" href="${url}" target="_blank">공고 보러 가기 →</a>
    </div>
  </article>`;
}

export function generateReport(jobs: ScoredJob[], outputPath: string): void {
  const timestamp = new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const topScore = jobs[0]?.score ?? 0;
  const avgScore = jobs.length
    ? Math.round(jobs.reduce((s, j) => s + j.score, 0) / jobs.length)
    : 0;
  const highFit = jobs.filter((j) => j.score >= 65).length;

  const cards = jobs.map((job, i) => jobCard(job, i)).join('');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Job Match Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --border: #272a38;
      --text: #e2e4ed;
      --muted: #6b7280;
      --accent: #818cf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans KR', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    /* ── HEADER ── */
    header {
      padding: 48px 32px 32px;
      border-bottom: 1px solid var(--border);
      max-width: 860px;
      margin: 0 auto;
    }
    .header-label {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.7rem;
      color: var(--accent);
      letter-spacing: 0.15em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    header h1 {
      font-size: clamp(1.6rem, 4vw, 2.4rem);
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }
    .header-sub {
      color: var(--muted);
      font-size: 0.8rem;
      margin-top: 8px;
      font-family: 'IBM Plex Mono', monospace;
    }
    .stats-row {
      display: flex;
      gap: 32px;
      margin-top: 28px;
    }
    .stat {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-num {
      font-size: 1.8rem;
      font-weight: 700;
      font-family: 'IBM Plex Mono', monospace;
      color: var(--accent);
      line-height: 1;
    }
    .stat-label { font-size: 0.75rem; color: var(--muted); }

    /* ── CONTROLS ── */
    .controls {
      max-width: 860px;
      margin: 24px auto 0;
      padding: 0 32px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .filter-label {
      font-size: 0.8rem;
      color: var(--muted);
      font-family: 'IBM Plex Mono', monospace;
    }
    .filter-val {
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 600;
      color: var(--accent);
      min-width: 28px;
    }
    input[type=range] {
      -webkit-appearance: none;
      height: 4px;
      background: var(--border);
      border-radius: 2px;
      width: 160px;
      cursor: pointer;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--accent);
      cursor: pointer;
    }
    .count-badge {
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--muted);
      font-family: 'IBM Plex Mono', monospace;
    }

    /* ── CARDS ── */
    .job-list {
      max-width: 860px;
      margin: 0 auto;
      padding: 0 32px 64px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      opacity: 0;
      transform: translateY(12px);
      animation: fadeUp 0.4s forwards;
    }
    @keyframes fadeUp {
      to { opacity: 1; transform: translateY(0); }
    }

    .card-top {
      padding: 20px 24px 16px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .card-top:hover { background: #1f2235; }

    .card-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 20px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .location {
      font-size: 0.75rem;
      color: var(--muted);
      font-family: 'IBM Plex Mono', monospace;
    }

    .card-title {
      font-size: 1.05rem;
      font-weight: 700;
      line-height: 1.3;
      margin-bottom: 4px;
    }
    .card-title a {
      color: var(--text);
      text-decoration: none;
    }
    .card-title a:hover { color: var(--accent); }
    .card-company {
      font-size: 0.82rem;
      color: var(--muted);
      margin-bottom: 10px;
    }
    .card-summary {
      font-size: 0.85rem;
      color: #9ca3af;
      line-height: 1.6;
    }

    .card-footer-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }
    .score-ring {
      position: relative;
      width: 44px;
      height: 44px;
    }
    .score-ring svg { width: 44px; height: 44px; }
    .score-num {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .toggle-hint {
      font-size: 0.72rem;
      color: var(--muted);
      font-family: 'IBM Plex Mono', monospace;
      transition: color 0.15s;
    }
    .card-top:hover .toggle-hint { color: var(--accent); }

    /* ── DETAIL ── */
    .card-detail {
      display: none;
      padding: 0 24px 20px;
      border-top: 1px solid var(--border);
    }
    .card-detail.open { display: block; }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      padding-top: 20px;
    }
    .detail-heading {
      font-size: 0.75rem;
      font-weight: 700;
      margin-bottom: 10px;
      letter-spacing: 0.04em;
    }
    .green-text { color: #34d399; }
    .amber-text { color: #fbbf24; }

    .detail-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .detail-list li {
      font-size: 0.8rem;
      color: #d1d5db;
      line-height: 1.5;
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 5px;
    }
    .dot.green { background: #34d399; }
    .dot.amber { background: #fbbf24; }
    .dot.gray  { background: #6b7280; }

    .apply-link {
      display: inline-block;
      margin-top: 20px;
      font-size: 0.78rem;
      color: var(--accent);
      text-decoration: none;
      font-family: 'IBM Plex Mono', monospace;
      border: 1px solid var(--accent);
      padding: 7px 14px;
      border-radius: 6px;
      transition: background 0.15s, color 0.15s;
    }
    .apply-link:hover {
      background: var(--accent);
      color: #0f1117;
    }

    .empty-msg {
      text-align: center;
      color: var(--muted);
      padding: 48px;
      font-size: 0.85rem;
      font-family: 'IBM Plex Mono', monospace;
    }

    @media (max-width: 600px) {
      header, .controls, .job-list { padding-left: 16px; padding-right: 16px; }
      .detail-grid { grid-template-columns: 1fr; }
      .stats-row { gap: 20px; flex-wrap: wrap; }
    }
  </style>
</head>
<body>

<header>
  <p class="header-label">// wanted job matcher</p>
  <h1>채용 공고<br>핏 분석 리포트</h1>
  <p class="header-sub">generated ${timestamp}</p>
  <div class="stats-row">
    <div class="stat">
      <span class="stat-num">${jobs.length}</span>
      <span class="stat-label">분석된 공고 수</span>
    </div>
    <div class="stat">
      <span class="stat-num">${highFit}</span>
      <span class="stat-label">65점 이상</span>
    </div>
    <div class="stat">
      <span class="stat-num">${avgScore}</span>
      <span class="stat-label">평균 점수</span>
    </div>
    <div class="stat">
      <span class="stat-num">${topScore}</span>
      <span class="stat-label">최고 점수</span>
    </div>
  </div>
</header>

<div class="controls">
  <span class="filter-label">최소 점수:</span>
  <input type="range" id="minScore" min="0" max="100" step="5" value="0" oninput="filterJobs(this.value)"/>
  <span class="filter-val" id="filterVal">0</span>
  <span class="filter-label">점 이상</span>
  <span class="count-badge" id="countBadge">${jobs.length}개 표시</span>
</div>

<div class="job-list" id="jobList">
  ${cards}
</div>

<script>
  function toggleCard(top) {
    const detail = top.nextElementSibling;
    const hint = top.querySelector('.toggle-hint');
    const isOpen = detail.classList.toggle('open');
    hint.textContent = isOpen ? '접기 ↑' : '상세 보기 ↓';
  }

  function filterJobs(val) {
    const min = parseInt(val);
    document.getElementById('filterVal').textContent = val;
    const cards = document.querySelectorAll('.card');
    let visible = 0;
    cards.forEach(card => {
      const show = parseInt(card.dataset.score) >= min;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    document.getElementById('countBadge').textContent = visible + '개 표시';
  }
</script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
}
