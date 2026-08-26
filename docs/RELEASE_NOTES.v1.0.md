# Grok Crew 1.0

로컬 숏폼 책장의 첫 안정 판입니다. GitHub Release 태그는 Maintainer가 올립니다. 이 문서는 그 본문 초안입니다.

공개 파일 하나: **Windows에서 열기** → `GrokCrew-Windows.exe`. 받는 곳: [v1.0.0 릴리스](https://github.com/NoLucas/Grok-crew-test/releases/tag/v1.0.0). 봇 zip은 다른 방법입니다.

## 받아서 연다

1. `GrokCrew-Windows.exe`를 받아 더블클릭합니다. 이 계정에만 들어갑니다. 관리자 비밀번호를 묻지 않습니다. 서명이 없어 파란 보호 화면이면 **추가 정보 → 그래도 실행**.
2. 제목을 적습니다. 스타일은 인스타 릴입니다.
3. **봇에게 이 말 복사**를 Cursor든 다른 에이전트든 한 창에 붙입니다.
4. 그 봇이 `handoff-inbox/editor`에 폴더를 두면 창이 열립니다.
5. 내 영상을 놓으면 봇 없이 타임라인이 열립니다.

`git clone` / `npm run local`은 소스를 받는 사람용입니다.

## 1.0에 들어 있는 것

- 짧은 책장: 제목, 놓기, 한 봇 초대문 (`source_mode: bot`)
- 문 둘: `editor/` · `collector/`. leftover `grok/` · `agents/`는 읽기만
- 역할 이름: 편집 Agent / 수집 Agent. Cursor·Claude·Grok은 역할이 아닙니다
- Cursor 에이전트: 같은 PC는 `POST /api/bot-entry`, 다른 컴퓨터는 인박스 폴더. 확인: `docs/CURSOR_AGENT.ko.md`
- 편집 문 자동 열기. 수집 인박스의 완성 컷은 거절
- 타임라인 v2, 로컬 MoviePy 렌더, 초안 프리뷰. 최종 파일은 원본
- 선택 게시: 가진 액세스 토큰. 영수증·재시도
- 핸드오프·경로·git remote 가드
- 봇이 둔 폴더: 한 줄로 접힘, 목록 옆 미리보기, 오른쪽 클릭으로 미리보기·크게 보기·원본 보기·삭제
- 화면 비율·화질·자막은 규격 잠금. 템포·룩·B-roll·훅·오디오는 설정에서 변경

## 1.0에 없는 것

- 서명된 `GrokCrew-Windows.exe` (SmartScreen 경고가 남을 수 있음)
- Instagram / TikTok / YouTube OAuth 앱
- macOS 공증, 자리 자동 업데이트 설치
- 로그인 벽이 있는 사이트를 긁기
- Local Studio를 인터넷에 열기

Windows에서 exe를 만들려면 그 PC에서 `npm run desktop:dist`입니다. SmartScreen은 서명 전이면 남을 수 있습니다. 파란 보호 화면이면 **추가 정보 → 그래도 실행**.

## 소스에서 열기

```sh
git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
cd grok-crew
npm run local
```

브라우저 기본은 `/` 데스크톱입니다. Local Studio는 `127.0.0.1:7214`입니다.

## 다른 방법

- 봇에게 줄 파일: `GET http://127.0.0.1:7214/downloads/grok-crew-bot.zip` (설치 파일 아님)
- 두 봇 규격: 책장의 **더 자세히**
- 변경 목록: `CHANGELOG.md`의 `1.0.0`

질문: [NoLucas/Grok-crew-test](https://github.com/NoLucas/Grok-crew-test) 이슈.
