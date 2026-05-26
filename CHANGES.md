# CHANGES — v1.0.0 → v1.1.0

라이브 원티드 API 호출로 전부 검증 후 수정.

## 치명적 결함 (수정 전: 도구가 실행 불가/오작동)

1. **공고 리스트 파싱 오류 → 즉시 크래시** (`wanted.ts`)
   - `data.jobs.data`로 읽었으나 실제 응답은 `{ links, data: [...] }`.
   - → `data.data`로 수정. 빈 응답 방어 로직 추가.

2. **직군 필터 무시** (`wanted.ts`)
   - `tag_type_ids[]`(대괄호)는 API가 인식 못 해 전체 공고가 섞여 들어옴
     (HR/마케터/펌웨어 등). → `tag_type_ids`(대괄호 제거)로 수정.

3. **폐기 예정 모델** (`scorer.ts`)
   - `claude-sonnet-4-20250514`는 2026-06-15 retire(이후 호출 실패).
   - → 기본값 `claude-haiku-4-5-20251001`(분류용 적합/저비용),
     `SCORER_MODEL` 환경변수로 교체 가능. 정밀도 우선 시 `claude-sonnet-4-6`.

## Robustness 개선

4. **스코어링 실패 격리 + 재시도** (`scorer.ts`)
   - 기존: API 호출이 try/catch 밖 → 한 건 429/529에 전체 실행 중단(작업 전부 소실).
   - → 호출을 try/catch로 감싸고 429/529/5xx에 지수 백오프(1→2→4s) 재시도.
     실패해도 해당 공고만 0점 처리하고 계속 진행.

5. **JSON 파싱 견고화** (`scorer.ts`)
   - 코드펜스(```json) 제거 + 첫 `{`~마지막 `}` 추출 fallback.
   - 응답 블록을 `content[0]` 고정 대신 type==='text'로 안전 탐색.

6. **max_tokens 600 → 1000** (`scorer.ts`): 한국어 출력 잘림(→0점) 방지.

7. **상세 조회 캐시** (`wanted.ts`): `.cache/job-details.json`.
   재실행 시 네트워크 요청·대기 생략(이력서 튜닝 반복 시 유용). `USE_CACHE=false`로 비활성화.

8. **경력 필터 상수화** (`wanted.ts`): `EXPERIENCE_YEARS`.
   -1=전체(기본), 0=신입. (검증: 0→인턴/신입 위주, -1→전체)

9. **CLI limit 인자 검증** (`index.ts`): NaN/음수 입력 시 기본값으로 폴백.

10. **escapeHtml 보강** (`reporter.ts`): 작은따옴표(`'`) 이스케이프 추가.

## 검증 결과
- `tsc --noEmit` 통과(에러 0).
- 라이브 스모크 테스트: 타깃 직군만 수집 / 상세 파싱 정상 / 2회차 캐시 히트 확인.

---

# CHANGES — v1.1.0 → v2.0.0 (로컬 LLM 전환)

비용 절감을 위해 Anthropic API → 로컬 Ollama로 전환. 최신 모델 동향 반영.

## 모델 선정 (RTX 4080 Super 16GB)
- 기본값 **`exaone3.5:7.8b`** (LG, 한국어 네이티브, Q4_K_M 4.8GB, 32K ctx) — KO 이력서×공고에 최적.
- 대안 `qwen2.5:14b` (보유 모델, KO 출력 우수, q4 16GB 적합).
- 제외: EXAONE 4.0/32B 등 32B 계열(19GB > 16GB), 추론 모델(EXAONE Deep/r1/qwen3 thinking → JSON 오염).

## 코드 변경
- `scorer.ts`: `@anthropic-ai/sdk` → `ollama`.
  - **JSON 스키마 강제**(`format` 파라미터)로 로컬 모델의 JSON 안정성 확보.
  - `temperature: 0`, `num_predict: 800`, `repeat_penalty: 1.0`(EXAONE 권장).
  - Ollama 미실행(ECONNREFUSED) 시 명확한 에러 메시지 + 즉시 중단.
  - 동시성 기본 1(단일 GPU 직렬 처리). `SCORER_CONCURRENCY`로 조정.
- `index.ts`: ANTHROPIC_API_KEY 체크 제거 → 모델/호스트 안내.
- `package.json`: 의존성 교체, v2.0.0.
- README: Ollama 설치/모델 pull/환경변수/모델 선택 가이드/ vLLM 업그레이드 경로 추가.

## 검증
- `tsc --noEmit` 통과(ollama 0.5.18, 타입 에러 0).
- 단, 실제 추론은 로컬 GPU+Ollama 환경 필요(이 빌드에선 미실행).
