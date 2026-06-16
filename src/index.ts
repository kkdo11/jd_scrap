import * as fs from 'fs';
import * as path from 'path';
import { fetchJobsWithDetails } from './wanted';
import { scoreAllJobs } from './scorer';
import { generateReport } from './reporter';

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════╗');
  console.log('║     Wanted Job Matcher v1.0      ║');
  console.log('╚══════════════════════════════════╝\n');

  // 1. 로컬 LLM(Ollama) 사용 안내
  const model = process.env.OLLAMA_MODEL ?? 'gemma4:12b';
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  console.log(`🧠 모델: ${model}  (host: ${host})`);
  console.log(`   Ollama 서버가 실행 중이어야 합니다: 'ollama serve' / 'ollama pull ${model}'\n`);

  // 2. resume.txt 로드
  const resumePath = path.join(process.cwd(), 'resume.txt');
  if (!fs.existsSync(resumePath)) {
    console.error('❌ resume.txt 파일이 없습니다.');
    console.error('   이력서 텍스트를 복사하여 resume.txt에 저장 후 다시 실행하세요.');
    process.exit(1);
  }
  const resume = fs.readFileSync(resumePath, 'utf-8').trim();
  console.log(`✅ 이력서 로드 완료 (${resume.length.toLocaleString()}자)\n`);

  // 3. 공고 수집 (기본 50개, CLI 인자로 조정 가능)
  const parsedLimit = parseInt(process.argv[2] ?? '50', 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
  if (parsedLimit !== limit) {
    console.warn(`⚠️  잘못된 limit 인자 무시 → 기본값 ${limit} 사용\n`);
  }
  const jobs = await fetchJobsWithDetails(limit);

  // 4. Claude 점수 산정
  console.log(`🤖 ${jobs.length}개 공고 AI 분석 시작...\n`);
  const scored = await scoreAllJobs(jobs, resume);

  // 5. 리포트 생성
  const outPath = path.join(process.cwd(), 'report.html');
  generateReport(scored, outPath);

  // 6. 결과 출력
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏆 TOP 5 추천 공고');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  scored.slice(0, 5).forEach((job, i) => {
    const bar = '█'.repeat(Math.round(job.score / 10)).padEnd(10, '░');
    console.log(`${i + 1}. [${bar}] ${job.score}점  ${job.position} @ ${job.companyName}`);
    console.log(`   ${job.summary}`);
    console.log(`   https://www.wanted.co.kr/wd/${job.id}\n`);
  });

  console.log(`\n📊 리포트 저장 완료 → ${outPath}`);
  console.log('브라우저에서 report.html 파일을 열어 확인하세요.\n');
}

main().catch((err) => {
  console.error('\n❌ 오류 발생:', err.message ?? err);
  process.exit(1);
});
