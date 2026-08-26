# Cursor 에이전트는 이렇게 붙습니다

2026-08-26에 이 책상에서 실제로 확인한 경로입니다. Cursor Cloud Agent가 저장소를 열고, 같은 PC의 Local Studio에 체크인하고, 편집 인박스에 패키지를 두면 컷이 들어옵니다.

역할 이름은 항상 **편집 Agent** / **수집 Agent**입니다. `created_by: Cursor`여도 역할은 편집 Agent로 저장됩니다. 브랜드를 역할로 바꾸지 않습니다.

## 확인한 것

| 경로 | 결과 |
|---|---|
| Cursor Cloud Agent (`cursor.com/agents`) | 이 세션이 `main`에 붙어 실행 중 |
| 같은 PC 체크인 `POST /api/bot-entry` | `bot_id=cursor-cloud-verify`, `display_name=Cursor` → `auto_local`, roster에 보임 |
| 짧은 책장과 같은 규격 저장 | `source_mode: bot`, `crew: false`, `door: editor`, `waiting_for_bot` |
| `GET /api/v2/edit-specs/{id}/invite` | `handoff-inbox/editor` 절대경로. `git clone` 없음 |
| 편집 인박스에 `created_by: Cursor` 패키지 | `POST /handoff/pull { door: "editor" }`가 프로젝트를 만듦 |

원격 Cursor 에이전트는 `127.0.0.1`에 붙지 않습니다. 초대문의 폴더에만 둡니다.

## 같은 컴퓨터의 Cursor

책장이 이 PC에서 켜져 있을 때:

```sh
python grok-crew.py entry --bot-id cursor-desk --display-name "Cursor" --purpose edit_video
```

스크립트는 `http://127.0.0.1:7214/downloads/grok-crew.py`입니다. 토큰이 켜져 있으면 런타임에서만 받습니다. `.env`를 읽지 않습니다.

끝난 컷은 `local_studio/workspace/handoff-inbox/editor/`에 둡니다. 책장이 받기 버튼 없이 엽니다.

## 다른 컴퓨터의 Cursor

1. 사람이 짧은 책장에서 **봇에게 이 말 복사**를 합니다.
2. Cursor 에이전트 창에 그 글을 붙입니다.
3. 에이전트는 원본과 첫 컷을 만들고 `bundle.json` + 영상 파일을 초대문의 인박스 폴더에 둡니다.
4. `bundle.project.door`는 `editor`, `created_by`는 `Cursor`, `edit_spec_id`는 초대에 있는 id입니다.
5. 이 PC의 책장이 pull 합니다. 수집 인박스에 완성 컷을 넣으면 거절합니다.

git으로 보낼 때는 `HANDOFF_REPO_REMOTE`가 있을 때만입니다. 없으면 로컬 폴더만 씁니다.

## 하지 않는 것

- Cursor만 편집 봇으로 고정하기
- 원격 에이전트가 loopback API를 호출하게 하기
- `/agent` 레거시 콘솔을 Cursor Cloud Agent 연결로 쓰기. 그 페이지는 프롬프트 계약 초안입니다.
