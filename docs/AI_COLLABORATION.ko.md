# 에이전트 협업 운영 규칙

이 문서는 Grok Crew Desktop을 Codex, Claude Code, Cursor Cloud Agent가 같은 제품 기준으로
개발하면서 계약 중복, 파일 덮어쓰기, 검증 누락을 최소화하기 위한 실행 규칙입니다. 최종
제품 판단과 병합 권한은 저장소 소유자인 사용자에게 있습니다.

Cursor가 **제품 봇**으로 붙는 경로(체크인·초대문·편집 인박스)는 `docs/CURSOR_AGENT.ko.md`입니다.
이 문서는 저장소를 고치는 개발 에이전트 규칙입니다.

## 1. 역할과 최종 권한

| 역할 | 책임 | 하지 않는 일 |
| --- | --- | --- |
| 사용자 / Maintainer | 요구사항 우선순위, UI 직접 검수, 외부 자격 증명, PR 승인·병합, 태그·릴리스 | 에이전트의 미검증 결과를 자동 병합하지 않음 |
| Codex / Integration Owner | 스키마·API·IPC 계약, SQLite migration, Electron main/preload, Python sidecar, 렌더·게시, 보안 경계, 통합 테스트, 릴리스 조립 | Claude 작업 브랜치의 사용자 변경을 임의로 덮어쓰지 않음 |
| Claude Code / Feature Implementer | 작업 패킷에 지정된 UI 동작·컴포넌트·focused test, 재현 절차와 스크린샷 증거 | 허용 목록 밖 수정, 계약의 독자 변경, main 병합·태그·릴리스 |
| Cursor Cloud Agent | Maintainer가 연 세션에서 지정한 슬라이스(문서, 데스크, 검증). 커밋은 현재 브랜치 | 태그·GitHub Release·PR 병합, OAuth/서명 값 지어내기 |

한 PR에는 한 명의 구현 책임자만 둡니다. 다른 에이전트는 같은 파일을 동시에 수정하지 않고
리뷰 의견 또는 후속 PR로 참여합니다.

## 2. 저장소와 브랜치 규칙

- GitHub 공개 저장소는 `https://github.com/NoLucas/Grok-crew-test.git` (`github` remote)입니다.
- Cursor Cloud Agent 세션의 `origin`은 Cursor git 호스트일 수 있습니다. 그때는 `origin`과 `github`를 같이 push한 뒤 upstream을 `origin`에 되돌립니다.
- Codex 브랜치는 `codex/<workstream>`, Claude Code 브랜치는 `claude/<workstream>`, Cursor 세션은 요청이 없으면 현재 브랜치를 유지합니다.
- 두 에이전트는 각각 별도 worktree 또는 clone에서 작업합니다. 같은 작업 폴더의 동시 편집은
  금지합니다.
- 모든 작업 패킷은 기준 commit SHA를 고정합니다. 작업 시작 후 main이 바뀌면 구현을 계속
  끌고 가지 말고, Integration Owner가 재배치 순서를 결정합니다.
- PR은 squash merge를 기본으로 하며 merge, tag, release는 Maintainer만 수행합니다.

권장 시작 절차:

```powershell
git status --short
git fetch https://github.com/NoLucas/Grok-crew-test.git main
git switch -c claude/<workstream> FETCH_HEAD
```

push할 때도 대상 URL을 명시합니다.

```powershell
git push -u https://github.com/NoLucas/Grok-crew-test.git HEAD
```

## 3. 계약 경계와 파일 소유권

다음 파일은 기본적으로 Codex가 단일 작성자입니다. Claude Code가 수정하려면 작업 패킷에
경로와 계약 변경 승인이 명시되어야 합니다.

- `local_studio/schemas/**`: timeline/control/event/patch/publish JSON Schema
- `local_studio/db.py`, `local_studio/desktop_domain.py`: migration과 불변 revision 규칙
- `local_studio/handlers.py`, `desktop/preload.cjs`: `/api/v2`와 renderer IPC 경계
- `desktop/main.mjs`, `desktop/relay-service.mjs`, `desktop/git-relay.mjs`: 로컬 권한과 relay
- `runner/crypto.mjs`, `runner/grok-crew-runner.mjs`: 서명·암호화·Runner 실행 경계
- `local_studio/render.py`, `local_studio/publishers/**`: 최종 출력과 외부 게시
- `package.json`의 packaging 설정과 `.github/workflows/**`: 출시·CI 기준

Claude Code의 기본 작업 영역은 작업 패킷에 지정된 `app/**` UI 파일과 해당 focused test입니다.
UI가 새 데이터나 동작을 요구하면 임시 필드, localStorage 우회, 중복 fetch wrapper를 만들지
않고 아래 형식으로 계약 요청을 남깁니다.

```text
Contract request
- consumer: app/... component
- missing operation or field: ...
- input validation: ...
- expected success/error states: ...
- stale/locked behavior: ...
```

## 4. P1 작업 분담과 순서

P1-01부터 P1-04는 아래 게이트를 순서대로 통과합니다. 선행 계약 PR이 merge되기 전에 UI가
가짜 계약을 먼저 확정하지 않습니다.

| 단계 | Codex 책임 | Claude Code 책임 | 병합 게이트 |
| --- | --- | --- | --- |
| P1-01 직접 편집 동작 | timeline patch 명령과 lock/stale validation, API/IPC 통합 | 드래그, trim, split, ripple, roll, slip, slide UI와 keyboard 상태 | golden fixture에서 patch 결과 일치, locked clip 수정 거부 |
| P1-02 트랙 편집 | group/lock/mute/solo/snapping/marker persistence | track header, 다중 선택, snapping·marker 상호작용 | 저장 후 재실행 동일, 다중 선택 E2E |
| P1-03 편집 이력 | undo/redo command stack과 새 불변 revision 생성 | 이력·undo/redo 상태와 접근 가능한 피드백 | branch divergence와 stale revision 회귀 테스트 |
| P1-04 프록시 편집 | 저해상도 proxy 생성·교체·원본 최종 렌더 연결 | proxy 상태·재생 전환·오류/재시도 UI | 미리보기 timing과 원본 렌더 duration/frame 대표값 일치 |

각 단계는 계약 PR과 UI PR을 분리합니다. 같은 파일이 필요한 경우에는 계약 PR을 먼저 merge한
뒤 UI 브랜치를 최신 main에 rebase하여 진행합니다.

## 5. 작업 패킷 - 구현 전 필수 입력

에이전트에게 작업을 맡길 때 다음 항목이 모두 있어야 합니다.

```markdown
## Task packet
- Workstream / owner:
- Base commit:
- User-visible outcome:
- Allowed paths:
- Forbidden paths:
- Frozen contracts and examples:
- Acceptance criteria:
- Required focused tests:
- Required full checks:
- Manual reproduction steps:
- Expected screenshots or fixtures:
- Dependencies / blocked-by PR:
```

`Allowed paths`가 없거나 기존 계약과 충돌하면 구현을 시작하지 않고 Integration Owner에게
질문합니다. 요구사항이 모호해도 데이터 손실, 보안, 게시, migration의 기본값을 추측하지 않습니다.

## 6. 오류를 줄이는 구현 루프

1. 시작 전 `git status --short`가 깨끗한지, 기준 SHA가 맞는지 확인합니다.
2. 실패를 재현하는 focused test 또는 fixture를 먼저 고정합니다.
3. 한 PR에서는 한 사용자 결과만 구현합니다.
4. 타입·스키마·에러 코드는 한 위치에서 정의하고 UI와 sidecar에 복사하지 않습니다.
5. loading, empty, offline, error, stale, locked, cancelled 상태를 정상 상태와 함께 검증합니다.
6. `npm run verify:core`와 Python 전체 테스트를 통과한 뒤 handoff를 작성합니다.
7. Electron 권한 경계를 건드렸으면 `npm run verify:desktop`과 패키징 smoke를 별도로 실행합니다.
8. Integration Owner는 diff, 계약 호환성, 보안 경계, 회귀 테스트를 확인한 뒤에만 Maintainer에게
   검수를 요청합니다.

## 7. 공통 검증 명령

```powershell
npm run verify:core
python -m pytest -q local_studio/tests
npm run verify:desktop  # Electron main/preload/tray 변경 시
```

출시 후보에서는 위 명령에 `npm audit --omit=dev`, `npm run desktop:dist`, 설치·업데이트·트레이
종료 수동 검수를 추가합니다. 외부 OAuth와 실제 게시 테스트는 사용자 승인 및 테스트 계정이
있을 때만 실행합니다.

## 8. Handoff 형식

```markdown
## Handoff
- Owner / branch / commit:
- Base commit:
- User-visible result:
- Files changed:
- Contracts changed: none | exact schema/API/IPC list
- Tests run and results:
- Manual steps and evidence:
- Known limitations:
- Follow-up owner:
- Safe rollback:
```

`통과함`처럼 요약하지 않고 명령, pass 수, 운영체제, 실패 또는 생략 이유를 적습니다. 로그에는
토큰, 로컬 영상 경로, private relay payload, 복호화된 transcript를 포함하지 않습니다.

## 9. 충돌과 실패 처리

- 기준 revision이 오래되었으면 자동 merge하지 않고 conflict review 상태로 보냅니다.
- 같은 파일을 양쪽 브랜치가 바꿨으면 마지막 작성자가 우선이라는 규칙을 쓰지 않습니다.
  Integration Owner가 두 diff의 의도를 비교해 새 통합 commit을 만듭니다.
- 테스트가 불안정하면 재실행으로 숨기지 않고 fixture, 환경, 최초 실패 로그를 남깁니다.
- 계약 누락, 데이터 손실 가능성, 자격 증명 노출, 중복 게시 위험이 보이면 즉시 작업을 중단하고
  Maintainer에게 결정을 요청합니다.
- rollback은 항상 새 timeline revision, PR revert, 또는 이전 릴리스 재설치처럼 복구 가능한
  방식으로 수행합니다.
