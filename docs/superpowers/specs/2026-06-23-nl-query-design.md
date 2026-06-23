# 조각 D — 자연어 쿼리 설계

> 작성일 2026-06-23 · 상태: 설계 승인됨, 플랜 대기
> 로드맵 맥락: 웹화 4조각 중 D. A(웹 GUI)·C(중복제거) 완료. [[web-gui-roadmap-status]]

## 문제

현재 시스템에는 검색어/쿼리 개념이 없다. 수집은 하드코딩된 직군 태그 ID 4개
(`src/wanted.ts:17` `TAG_IDS = [872, 839, 940, 655]` — 백엔드/AI·ML/DevOps/데이터엔지니어)로만
이뤄지고, 사용자 입력은 이력서 텍스트 + limit(개수)뿐이다. "프론트엔드 원해"는 불가능하다.

**안 만들면:** 사용자는 영원히 고정된 4개 직군 신입 공고만 받는다. 매칭 도구 본질상 직군을
못 고르는 건 핵심 결함 → 진행 결정(Go).

## 결정 요약

| 항목 | 결정 |
|---|---|
| 쿼리 범위 | 직군(태그) + 키워드 둘 다 |
| 변환 방식 | LLM 추출 + 코드 매핑 (gemma가 자연어→`{직군명[], 키워드[]}`, 코드 사전이 직군명→태그ID) |
| 쿼리 필수 여부 | 필수 — 텍스트·칩 둘 다 없으면 실행 불가 |
| 입력 수단 | 자유 텍스트 입력 + 프리셋 직군 칩(다중 선택) 병행 |
| 칩 다중 선택 | 허용 (현재 4직군 동시 수집 행태를 사용자 선택형으로 일반화) |
| CLI | 불변 (조각 C와 동일, 웹 전용 기능) |

## 입력 모델 (UX)

검색 영역에 두 입력. **둘 중 하나 이상**이 있어야 실행 가능(없으면 실행 버튼 비활성 + 서버 400).

```
검색: [ 자유 입력: "자바 잘하는 신입 백엔드"            ]
빠른 선택: [백엔드] [프론트엔드] [AI/ML] [DevOps] [데이터엔지니어]  ← 다중 선택
```

- **칩(다중 선택):** 클릭한 직군 → 즉시 태그 ID. LLM 안 거침.
- **자유 입력:** gemma가 `{직군명[], 키워드[]}` 추출 → 코드 사전이 직군명→태그ID 매핑.
  키워드는 수집 검색어로 사용.
- **병합:** 최종 태그 = 칩 태그 ∪ 자유입력 추출 태그. 키워드 = 자유입력에서.

## 컴포넌트

### 신규
- **`src/jobTags.ts`** — 직군 사전(표시명/별칭 → 태그 ID). 단일 진실원천.
  프론트 칩 목록도 여기서 파생(`/tags` 엔드포인트로 노출해 동기화).
  - 타입: `SearchSpec { tagIds: number[]; keywords: string[] }`
  - 표시명/별칭 매핑 + `nameToTagId(name): number | undefined`
- **`src/queryParser.ts`** — gemma 호출(`src/scorer.ts:42-110`의 Ollama 클라이언트 +
  JSON `format` + `think:false` + `temperature:0` 패턴 재사용).
  - `parseQuery(text): Promise<SearchSpec>` — 자유 텍스트 → `{직군명[], keywords[]}` 추출 →
    jobTags로 직군명→태그ID 매핑 → `SearchSpec` 반환.

### 변경
- **`src/wanted.ts`** — 하드코딩 `TAG_IDS` 제거. `SearchSpec`를 받아 `tag_type_ids`(가변) +
  키워드를 쿼리로 조립. (`fetchJobList`, `fetchJobsWithDetails` 시그니처에 `searchSpec` 추가)
- **`src/pipeline.ts`** — `runPipeline`에 `searchSpec` 인자 추가, `PipelineDeps.fetchJobs`
  타입(`src/pipeline.ts:6`) 확장, `fetchJobs` 호출로 스레딩.
- **`src/server.ts`** — `/run` body에 `queryText?`, `tagIds?` 추가. "최소 하나" 검증.
  queryText 있으면 `parseQuery` 호출, 칩 `tagIds`와 병합해 `SearchSpec` 구성 후 runPipeline 전달.
  신규 `GET /tags`(직군 사전 표시명+ID 반환).
- **`public/index.html` · `public/app.js`** — 자유 입력칸 + 칩 UI(`/tags`에서 렌더),
  payload에 `queryText`/`tagIds` 추가, 빈 입력 가드(실행 버튼 비활성).

## 데이터 흐름

```
프론트(텍스트/칩 선택)
  → POST /run { resume, limit, queryText?, tagIds? }
  → 서버: queryText면 parseQuery→SearchSpec, 칩 tagIds 병합
  → runPipeline(resume, limit, searchSpec, onProgress, deps, excludeIds)
  → fetchJobs(limit, excludeIds, searchSpec)
  → 원티드 API (tag_type_ids 가변 + 키워드)
```

## 에러 처리

- **빈 쿼리**(텍스트·칩 둘 다 없음) → 프론트 실행 버튼 비활성 + 서버 400.
- **gemma 파싱 실패/JSON 깨짐** → 칩이 있으면 칩만으로 진행. 칩도 없으면 **원문을 키워드로**
  폴백 후 진행. (scorer 견고화 패턴 재사용)
- **자유입력 직군이 사전에 없음** → 키워드로만 수집(태그 비움).

## CLI 하위호환

조각 C와 동일하게 CLI 불변. CLI는 기존 4직군을 기본 `SearchSpec`로 넘겨 동작 유지.
자연어 쿼리 입력은 웹 전용.

## 테스트 전략

- `jobTags`: 표시명/별칭 → ID 매핑(미존재 직군 포함) 테이블 기반.
- `queryParser`: Ollama mock으로 추출→매핑, JSON 깨짐 폴백.
- `server`: 빈 쿼리 거부(400), 칩만/텍스트만/병합 경로.
- `wanted`: 가변 `tag_type_ids` + 키워드 쿼리 URL 조립 검증.
- `pipeline`: `searchSpec` 스레딩.

## RAID

| 구분 | 항목 |
|---|---|
| Risk | 원티드 내부 API가 `tag_type_ids` + 키워드 `query`를 **동시에** 받는지 전례 없음. |
| Assumption | 동시 사용 가능. **불가 시 대안**: 키워드를 수집 후 제목/내용 `includes` 필터로 적용(`EXCLUDE_KEYWORDS` 패턴 역방향). 플랜 1단계에서 실제 호출로 검증 후 분기 확정. |
| Assumption | gemma 단일 운용, `think:false` 필수(전 공고 0점 함정 회피). [[gemma4-thinking-model-gotcha]] |
| Dependency | 기존 Ollama/gemma 인프라(`src/scorer.ts`), 원티드 내부 API(`src/wanted.ts`). |
| Dependency | 직군 사전 초기 범위 = 현재 4직군 + 프론트엔드(플랜에서 태그 ID 실측 확정). |
