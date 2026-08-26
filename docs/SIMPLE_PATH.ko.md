# 짧은 기본 경로 — 만드는 순서

사람이 걷는 길: **받는다 → 연다 → 적는다 → 붙인다.** 컷이 오면 창이 연다.

이 문서가 구현 순서다. 봇 zip·모든 계정 exe·PDF는 `docs/DOWNLOAD_SPLIT.ko.md`의 숨긴 준비물이다. 기본이 열리기 전에는 만들지 않는다.

날짜는 적지 않는다. 한 판이 끝나면 다음 판만 연다.

## 이미 있는 것 (새로 만들지 말 것)

| 이미 있음 | 기본 경로에서 쓰는 법 |
|---|---|
| `source_mode: bot`, `waiting_for_bot` | 기본 저장. `crew: true`를 보내지 않으면 된다 |
| `instagram_reel` 레시피 | 스타일 기본값. 첫 화면에 네 장을 펼치지 않음 |
| `GET .../brief` | 봇에게 줄 긴 글. 사람은 더 짧은 **초대문**만 복사 |
| `GET /downloads/grok-crew.py` | 같은 PC 봇이 CLI가 필요할 때. 사이트 두 번째 버튼 아님 |
| 5초마다 workspace 새로고침 | 인박스 숫자가 있으면 여기서 자동으로 pull |
| `POST /api/v2/handoff/pull` | 받기 버튼 대신 책상이 조용히 호출 |
| 샘플 한 번 열기 | “내 영상 놓기” 옆 작은 글 |
| 사이드카를 exe에 넣는 설정 | 1판 설치가 창+서비스를 같이 띄움 |

짧은 책장이 기본이다. `source_mode: bot`, 초대문 복사, 편집 문 자동 열기. 레시피 네 장·수집/편집 칸·받기 버튼은 **더 자세히** 뒤에만 있다.

## 창이 열렸을 때 화면

한 화면이다. 버튼 세 개로 나누지 않는다.

```
제목  [15초 훅 릴            ]

무엇을 말할까 (한 칸, 비워도 됨)

[ 영상을 여기 놓거나 고르기 ]

[ 봇에게 이 말 복사 ]

인스타 릴 · 다른 스타일
샘플로 화면 보기
```

동작:

- **복사** — 규격을 한 봇 문으로 저장하고, 짧은 초대문을 클립보드에 넣는다. 저장과 복사가 한 번이다.
- **영상 놓기** — 봇 없이 타임라인을 연다. 기존 내 파일 열기다.
- **다른 스타일** — 접혀 있다. 펼치면 틱톡/쇼츠/본편.
- **더 자세히** — 접혀 있다. 지금의 규격 책장(역할 둘, 소스 모드). 기본이 아니다.

없는 것: 수집 봇 칸, 편집 봇 칸, 두 보낼함 안내, 받기 버튼, 문 이름, 폴더 경로, Runner, git.

## 초대문에 들어갈 말

사람은 읽지 않아도 된다. 봇이 실행한다. 한글이다.

```
이 컴퓨터의 Grok Crew 책상이 켜져 있습니다.
제목: {title}
형태: 인스타 릴, 세로, 21–30초.
원본과 첫 컷을 당신이 만듭니다. 운영자는 영상을 주지 않습니다.

같은 컴퓨터에서 명령할 수 있으면:
  python grok-crew.py entry --bot-id {id} --display-name "당신의 이름" --purpose edit_video
  (스크립트는 http://127.0.0.1:7214/downloads/grok-crew.py)

끝난 패키지는 이 폴더에 둡니다:
  {inbox_dir}
127.0.0.1 말고는 붙지 마세요.
```

중요: 받은 사람이 git clone이 없다. 초대는 저장소 경로 `local_studio/grok_crew.py`를 말하지 않는다. 루프백 다운로드 또는 받을함 폴더만 말한다.

`GET /api/v2/edit-specs/{id}/invite`가 이 글을 만든다. `brief`는 그대로 둔다. 자세히 보기용이다.

## 만드는 판

### A판 — 짧은 책상만 보이게

창이 켜지면 위 화면이 기본이다. 설치 파일 없이 브라우저/`npm run local`로 확인한다.

할 일:

- [x] `app/desktop-simple-desk.tsx`를 만든다. 제목, 목표, 놓기, 복사, 접힌 스타일.
- [x] `desktop-workspace.tsx`에서 프로젝트 없을 때 `SpecDesk` 대신 이것을 연다.
- [x] 지금의 `SpecDesk`는 “더 자세히” 뒤에만 둔다. 지우지 않는다.
- [x] 기본 `recipe_id`는 `instagram_reel`. 기본은 `crew`를 보내지 않는다.
- [x] 복사 전에는 제목이 비면 저장하지 않는다. 목표는 비면 제목을 한 번 더 쓴다.
- [x] 모바일에서도 제목·복사·놓기가 세로로 쌓인다.

건드리는 곳: `app/desktop-simple-desk.tsx`(신규), `app/desktop-workspace.tsx`, 짧은 CSS.

완료: 빈 책상에서 레시피 네 장·수집/편집 칸·받기 버튼이 보이지 않는다. 제목을 적고 복사하면 규격이 생긴다.

확인: 브라우저에서 제목 넣고 복사. `/api/v2/edit-specs` 목록에 `source_mode: bot`, `crew: false`. 기존 자세히 책장이 아직 열리는지.

### B판 — 초대문 API

할 일:

- [x] `edit_spec.py`에 `spec_invite(id, language)`를 둔다. 제목, 레시피 한 줄, 인박스 절대경로, 루프백 CLI 한 줄.
- [x] `GET /api/v2/edit-specs/{id}/invite`를 `handlers.py`에 붙인다.
- [x] 짧은 책상의 복사가 저장 뒤 이 글을 클립보드에 넣는다. 성공하면 “봇 창에 붙여 넣으세요.”
- [x] 테스트: 한 봇 규격을 만들고 초대문에 제목과 `handoff-inbox/editor`이 있는지. `local_studio/grok_crew.py` 클론 경로가 없는지.

건드리는 곳: `local_studio/edit_spec.py`, `handlers.py`, `tests/test_edit_spec.py`, 짧은 책상.

완료: 복사 한 번에 봇이 읽을 글이 들어간다. 사람에게 CLI 사용법을 가르치지 않는다.

### C판 — 저장 기본을 한 봇으로

A판 UI가 실수로 `crew: true`를 보내면 다시 길어진다.

할 일:

- [x] 짧은 책장 POST 본문에 `source_mode: "bot"`을 명시한다. `crew`는 넣지 않거나 false.
- [x] 파일을 고른 뒤에만 `source_mode: "own"`이거나, 아예 봇 없이 타임라인만 연다. 기본 경로는 후자다.
- [x] `normalize_spec` 기본은 이미 `bot`이다. 테스트를 잠근다: crew 없이 저장 → `waiting_for_bot`, 보낼함은 `handoff-outbox/editor`만.
- [x] 자세히 책장의 collect 기본은 유지한다. 짧은 책장이 덮지 않는다.

완료: 짧은 책장으로 저장한 규격은 수집 보낼함이 비어 있다.

### D판 — 받기 버튼 없이 도착

할 일:

- [x] `desktop-workspace.tsx`의 5초 새로고침에서 `handoff.doors.editor.pending_count > 0`이면 `POST /api/v2/handoff/pull` `{ door: "editor" }`를 한 번 호출한다.
- [x] 가져온 `project.id`가 있으면 그 프로젝트를 연다. “○○이 넘긴 컷을 열었습니다.”
- [x] 같은 폴더를 5초마다 두 번 pull하지 않게, 진행 중 플래그를 둔다.
- [x] 짧은 책장에는 받기 버튼을 두지 않는다. 자세히 책장의 받기·예시는 그대로 둬도 된다.
- [x] 에이전트 문 자동 pull은 기본에 넣지 않는다. 한 봇 문만.

완료: 데모 패키지를 인박스에 두면 버튼 없이 타임라인이 열린다. `POST .../pull { demo: true }`를 개발 확인용으로 쓸 수 있다. 짧은 책장 버튼은 아니다.

확인: `write_demo_package` 후 새로고침만으로 `received` + 프로젝트 열림.

### E판 — 입구 문장, 버튼 하나

설치 파일이 아직 없어도 문장은 먼저 고친다.

할 일:

- [x] README 네 언어 여는 방법: **Windows에서 열기**. `git clone` / `npm run local`은 “소스 받는 사람” 아래.
- [x] 릴리스 본문도 버튼 하나. 봇 zip·PDF는 쓰지 않거나 “다른 방법” 한 줄.
- [x] “관리자로 할까요” 문구가 어디에도 없는지 검색한다.

완료: 첫 문장이 받아서 연다. 고를 파일이 둘이 아니다.

### F판 — Windows에서 바로 열리는 파일

Linux 개발 기계에서는 최종 exe를 사용자에게 주지 못한다. 설정과 스크립트만 넣고, 산출은 Windows에서 `npm run desktop:dist`다.

할 일:

- [x] `package.json` `build.nsis`: `oneClick: true`, `perMachine: false`, 폴더 고르기 없음.
- [x] 공개 파일 이름 `GrokCrew-Windows.exe`.
- [x] 설치 후 바로 실행. 사이드카 `extraResources`는 유지.
- [x] 마법사 페이지(다음, 경로, 관리자)가 없어야 한다.
- [x] README 링크가 이 파일을 가리키게 E판과 맞춘다.

완료: 비밀번호 없이 더블클릭 → 짧은 책장. SmartScreen은 서명 전이면 남을 수 있다. 같은 페이지 그림 세 장으로만 설명한다. PDF 다운로드는 아직 만들지 않는다.

하지 않음: `notarize: true`, 봇용 exe, 사이트에 두 번째 파일.

### G판 — 숨긴 준비물 (기본이 열린 뒤)

`docs/DOWNLOAD_SPLIT.ko.md` 2~6판. 기본 경로가 A–F로 통과한 뒤에만.

- [x] 봇 zip: `GET /downloads/grok-crew-bot.zip`, `npm run dist:bot-pack`. 설치 파일이 아니다.
- [x] 책장 **안 열리면**에 세 줄 + 봇 파일 링크. 필수 PDF 다운로드는 없다 (`docs/install-guide/열기.ko.md`).
- 모든 계정 exe·압축 실행 zip은 문서의 예비다. 기본 버튼이 아니다. 이 Linux 기계에서 그 exe를 만들지 않는다.

## 파일 지도

| 판 | 신규 | 수정 |
|---|---|---|
| A | `app/desktop-simple-desk.tsx` | `app/desktop-workspace.tsx`, 데스크톱 CSS |
| B | | `edit_spec.py`, `handlers.py`, `tests/test_edit_spec.py`, 짧은 책상 |
| C | | 짧은 책장 POST, `tests/test_edit_spec.py` |
| D | | `app/desktop-workspace.tsx` |
| E | | `README.md`, `README.ko.md`, `README.zh.md`, `README.ja.md` |
| F | | `package.json` `build.nsis` |
| G | `scripts/pack-bot-bundle.*`, `docs/bot-pack/` | 릴리스 자산 |

기존 `desktop-spec-desk.tsx`는 G/자세히용으로 남긴다. A에서 지우지 않는다.

## 판을 건너뛰지 않는 이유

```
A 화면     → 빈 책장이 짧아진다 (지금 여기서 확인 가능)
B 초대문   → 복사가 진짜 봇 글이 된다
C 계약     → 한 봇 보낼함만 쓴다
D 도착     → 받기 버튼이 필요 없어진다
E 문장     → 사이트에서 고를 일이 없어진다
F exe      → 받아서 연다가 성립한다
G 예비     → 기본이 막힌 사람만
```

A 없이 F만 하면 받은 사람이 다시 긴 책장을 본다. F 없이 A–D만 하면 `npm run local` 사용자는 짧아지지만 “다운로드만으로”는 안 된다. 둘 다 필요하나, **이 저장소에서 먼저 할 것은 A→D**다.

## 하지 않는 일

- 짧은 책장에 수집/편집 이름을 다시 넣기
- 기본 저장을 `crew: true` / `collect`로 보내기
- 자동 pull을 `agents/` 문까지 넓히기
- 초대문에 git clone, `handoff-outbox/collector`, purpose 선택지를 사람 문장으로 설명하기
- 다운로드 페이지에 봇 zip을 기본 버튼으로 두기
- Instagram 앱, Mac 공증, loopback을 인터넷에 열기
- 문 폴더를 다시 `grok/` · `agents/`로 되돌리기. 쓰기는 `editor/` · `collector/`만. leftover는 읽기만.

## 확인 한 줄

| 판 | 되면 끝 |
|---|---|
| A | 첫 화면에 제목·놓기·복사만 있다 |
| B | 복사 글에 제목과 받을함 경로가 있고, clone 경로가 없다 |
| C | 생긴 규격이 `bot` / `waiting_for_bot` / editor 보낼함만 |
| D | 인박스에 패키지를 두면 버튼 없이 프로젝트가 열린다 |
| E | README 첫 설치가 파일 하나다 |
| F | 더블클릭 → 짧은 책장. 비밀번호 없음 |
| G | 기본 버튼을 가리지 않는다 |

## 다음에 손댈 것

A–G는 이 저장소에 들어 있다. Cursor 에이전트 연결은 `docs/CURSOR_AGENT.ko.md`에서 확인했다. 1.0 노트는 `docs/RELEASE_NOTES.v1.0.md`다.

남는 일은 Windows 기계에서 `npm run desktop:dist`로 `GrokCrew-Windows.exe`를 만드는 것, 그리고 서명 전 SmartScreen 그림 세 장이다. 이 Linux 개발 기계에서는 사용자에게 줄 exe를 만들지 않는다. 태그·GitHub Release는 Maintainer가 올린다.
