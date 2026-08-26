# Grok Crew Desktop 개발 프리뷰

이 브랜치는 기존 Local Studio와 CLI를 유지하면서, 사람이 설정과 상태를 중심으로 사용하는 Electron 데스크톱 작업 공간을 추가합니다. 원본·렌더·게시 자격 증명은 로컬에 남고 Runner에는 에셋 ID, 타임코드, 대본, 선택된 장면 썸네일만 암호화해 전달합니다.

## 실행

개발 모드:

```powershell
npm install
npm run desktop
```

Windows 패키지:

```powershell
npm run desktop:pack
npm run desktop:dist
```

`desktop:pack`은 `release/win-unpacked`를, `desktop:dist`는 NSIS 설치 파일을 만듭니다. macOS에서는 같은 명령이 DMG를 만들며, 공개 배포용 코드 서명과 notarization 자격 증명은 별도로 설정해야 합니다.

브라우저 전용 개발 화면은 `npm run local`로 실행합니다. 브라우저의 `/`는 Electron과 같은 데스크톱 작업 공간입니다. `/production` 같은 레거시 페이지는 남아 있고, 기획·미리보기이거나 이전 콘솔입니다. 데스크톱 앱은 임의의 loopback 포트와 실행별 토큰을 사용하며 renderer에 포트나 토큰을 노출하지 않습니다.

## 현재 제공되는 흐름

1. `Videos/Grok Crew/inputs`의 원본으로 프로젝트를 만듭니다.
2. 콘텐츠 유형, 훅, 속도, 자막, 룩, 음향, FPS, 품질과 플랫폼별 게시 정책을 고릅니다.
3. 로컬 분석이 장면 썸네일·미디어 정보와 선택적으로 whisper.cpp 단어 대본을 만듭니다.
4. `Grok으로 제작 시작`이 현재 timeline revision에 고정된 control job을 만듭니다.
5. Runner 키를 페어링합니다. 앱 안에서 GitHub 브라우저 로그인 또는 access token 로그인을 한 뒤 기존 비공개 clone을 선택하거나 전용 비공개 저장소를 만듭니다. 토큰은 Electron `safeStorage`를 통해 Windows Credential Manager/macOS Keychain으로 암호화됩니다.
6. `Grok으로 제작 시작`은 작업을 생성한 뒤 연결된 relay의 `control` 브랜치로 암호화 요청을 자동 전송합니다.
7. 서명된 결과는 새 불변 timeline revision으로 적용됩니다. stale revision이나 잠금 충돌은 자동 병합하지 않고 Inspector의 충돌 카드에서 폐기하거나 현재 revision으로 다시 요청합니다.
8. Grok의 `needs_input` 결과는 Inspector 선택 카드로 표시되며, 선택은 같은 control job/Grok 세션의 후속 암호화 요청이 됩니다.
9. 취소·일시정지는 서명·암호화된 control 명령입니다. Runner는 실행 중 Grok 프로세스를 종료하고 서명된 취소/일시정지 영수증을 반환합니다. 재개·재시도는 attempt와 단조 증가 event sequence를 유지해 오래된 결과가 새 시도를 덮어쓰지 못하게 합니다.
10. `자동 편집 + 렌더`는 결과 적용 뒤 로컬 렌더가 끝날 때까지 추적하고 `rendered`, `publish_waiting`, `completed`, `failed` 중 검증된 종결 상태를 저장합니다. 버전 목록에서 어느 revision이든 새 revision으로 복원할 수 있습니다.

## Runner

Grok Build가 인증된 별도 환경에서:

```sh
node runner/grok-crew-runner.mjs init --state .runner-state --runner-id studio-runner --name "Studio Runner"
node runner/grok-crew-runner.mjs trust-desktop --state .runner-state --desktop-public desktop-public.json
node runner/grok-crew-runner.mjs run-file --state .runner-state --request request.json --output response
node runner/grok-crew-runner.mjs run-repo --state .runner-state --repo /path/to/private-relay-clone --watch --interval 5
```

Runner는 데스크톱 서명을 검증하고 X25519/HKDF/AES-256-GCM으로 요청을 복호화합니다. Grok Build는 streaming JSON, 전용 작업 폴더, 제한된 도구 권한으로 실행되며 전체 자동 승인 플래그를 사용하지 않습니다.

Git relay는 데스크톱 전용 `control` 브랜치와 `runner/<id>` 브랜치를 사용합니다. `requests/<job>.request.json`과 `controls/<job>.control.json`은 모두 데스크톱이 서명·암호화합니다. Runner는 단계가 바뀔 때 서명된 event를 commit하고 데스크톱은 최대 5초 간격으로 새 event/result를 동기화합니다. 같은 job의 후속 선택은 새 blob hash와 증가한 attempt로 다시 처리되고, 데스크톱은 서명 검증과 sequence 검사를 통과한 새 결과만 한 번 적용합니다.

GitHub OAuth 앱을 등록한 배포에서는 Electron 프로세스에 `GROK_CREW_GITHUB_CLIENT_ID`를 제공하면 device flow 버튼이 활성화됩니다. 등록 전 개발 프리뷰에서도 앱 내부 token 입력으로 연결할 수 있으며, 값은 renderer 상태에서 즉시 지우고 OS 보안 저장소에만 보관합니다. 새 저장소 생성은 GitHub REST API와 Git을 사용하므로 GitHub CLI는 필요하지 않습니다.

## 로컬 대본과 게시 자격 증명

`.env.example`의 `WHISPER_CPP_BINARY`, `WHISPER_CPP_MODEL`을 설정하면 분석 단계에서 단어 단위 대본을 생성합니다. Instagram, TikTok, YouTube 토큰도 환경 변수에서만 읽으며 UI·SQLite·로그에 저장하지 않습니다. 게시 정책의 기본값은 모든 플랫폼에서 `게시 전 확인`입니다.

## 호환성과 현재 범위

- 기존 `/api/*`, CLI, Production 및 레거시 화면은 유지됩니다. 새 기능은 `/api/v2/*`를 사용합니다.
- 현재 렌더러는 다중 영상·이미지·오디오·자막·오버레이 트랙, 기본 transform/opacity/volume/speed를 처리합니다.
- P1 직접 편집·트랙·이력·프록시·키프레임·전환/자막·오디오 믹서·렌더 골든·Electron E2E가 연결되어 있습니다. 프로그램 모니터는 플레이헤드의 합성 프레임을 최종 MoviePy 렌더와 같은 경로로 만듭니다.
- P2 고급 편집의 첫 슬라이스도 포함됩니다: 마스크·블렌드·크로마 키, 스피드 램프·트래커 부착·안정화, nested sequence·multicam, LUT/컬러 휠/스코프, EQ·컴프레서, EDL/OTIO 교환과 렌더 큐. After Effects급 합성·플러그인 SDK·실시간 공동 편집은 1.0 범위 밖입니다.
- P3 안정 1.0 로컬 게이트: 게시 영수증·재시도·중단 정리, `/api/v2/launch`, GitHub 릴리스 알림(설치는 서명 채널이 생길 때까지 외부). Instagram/TikTok/YouTube OAuth 앱과 macOS 서명/notarization은 이 저장소에서 만들지 않습니다.
- UI Quality Track UI-01..UI-10: 시각 계층, 8px 간격, 빈/로딩/오류 상태, 포커스 링, 좁은 화면에서 설정·편집·내보내기 탭 유지, 프로젝트/상태 서랍, 스테이지 가독성, 커맨드바·영수증 안내.
- GitHub 전용 비공개 저장소 생성/기존 clone 선택, 앱 내 token 로그인, 선택적 OAuth device flow와 `control` / `runner/<id>` watcher가 구현되어 있습니다. 공개 OAuth 앱 등록과 macOS 서명/notarization은 외부 자격 증명이 필요한 출시 게이트입니다.

## 검증

```sh
cd local_studio && python -m pytest -q
npm run runner:test
npm run launch:verify
npm run lint
npm run build
npm audit --omit=dev
```

PyInstaller sidecar는 `npm run sidecar:build`로 검증할 수 있습니다.
