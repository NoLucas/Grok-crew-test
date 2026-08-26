# Grok Crew

<p align="center"><a href="README.md">English</a> &nbsp;·&nbsp; <strong>한국어</strong> &nbsp;·&nbsp; <a href="README.zh.md">简体中文</a> &nbsp;·&nbsp; <a href="README.ja.md">日本語</a></p>

**Grok Crew는 내 컴퓨터의 숏폼 책상입니다. 규격은 사람이 적고, 문은 두 개입니다. Grok 전용 문과 다른 에이전트 전용 문.**

이 컴퓨터에 원본을 두지 않아도 됩니다. 길이와 자막, 남길 말, 어느 문이 할지 정하면 됩니다. **다른 컴퓨터**의 봇이 영상과 컷을 만들어 그 문 폴더로만 보냅니다. 이 PC는 받아서 보여 줍니다. Instagram·TikTok·YouTube는 원할 때만 올립니다.

영상을 맡아 주는 웹사이트가 아닙니다. 봇은 이 PC를 열지 않고, 패키지만 보냅니다.

```
내 규격  →  그 문 보낼함  →  봇이 spec.json 을 가져감  →  그 문 인박스  →  이 PC가 받음  →  내가 원할 때만 게시
```

## 누가 쓰나요

- 릴이 어떻게 나와야 하는지만 정하고 싶은 사람
- Grok에게, 또는 Claude·Codex·ChatGPT에게 원본과 첫 컷을 맡기되 문을 섞지 않고 싶은 사람
- 완성 파일은 그래도 이 PC에 두고 싶은 사람

시작하려면 계정이 필요 없습니다.

## 화면에 보이는 것

첫 화면에는 **문이 두 개**입니다. Grok 문 또는 다른 에이전트 문에 규격을 저장하면 그 문 보낼함(`handoff-outbox/grok` 또는 `handoff-outbox/agents`)에 올라갑니다. 봇은 그곳의 `spec.json`을 읽습니다. git이면 `outbox/grok/` · `outbox/agents/`입니다. 이 PC는 열지 않습니다. 끝난 Grok 패키지는 `handoff-inbox/grok`, Claude·Codex·ChatGPT는 `handoff-inbox/agents`에 둡니다. **받기**는 자기 문만 가져오고, 그 규격은 보낼함에서 치웁니다. 글 복사는 예비입니다. **이 문으로 예시 도착 보기**는 같은 도착을 번들 클립으로 보여 줍니다.

그다음은 세 탭입니다.

| 탭 | 하는 일 |
| --- | --- |
| **편집** | 미리보기를 보고 타임라인에서 자릅니다 |
| **설정** | 분위기, 자막, 속도 |
| **내보내기** | 이 컴퓨터에 MP4를 저장하거나, 물어본 뒤에 게시합니다 |

미리보기는 빠르게 보는 초안입니다. 저장하는 파일은 봇이 넘긴 원본으로 만듭니다. 이 컴퓨터에 이미 있는 파일을 직접 여는 것은 규격 아래 선택 사항입니다.

## 영상은 이 컴퓨터에 남습니다

원본, 편집, 완성본은 이 PC에 있습니다. Grok Crew 클라우드 프로젝트도, 시작용 로그인도 없습니다.

게시는 선택입니다. 기본은 **게시 전 확인**입니다. 이미 올라갔을 수 있으면 한 번 더 보내기 전에 다시 묻습니다. Instagram·TikTok·YouTube 계정은 Grok Crew가 만들어 주지 않습니다.

## 선택: 이 PC의 AI에게 시키기

**같은 컴퓨터**에서 이미 AI가 켜져 있다면, 평범한 말로 시킬 수 있습니다. 센 대사만 남기고, 자막 넣고, 세로로 자르고, 파일은 여기에 두고, 올리지는 마.

다른 컴퓨터의 AI는 이 책상을 열 수 없습니다. 다른 곳의 봇이 “한번만 보게” 영상을 보내지 않습니다.

## 여는 방법

이미 누군가 설치해 두었다면 Grok Crew 창을 열면 됩니다. 또는 브라우저에서 [http://localhost:3000](http://localhost:3000/)입니다.

직접 설치한다면 [Node.js 22 이상](https://nodejs.org/)과 [Python 3.10 이상](https://www.python.org/downloads/)이 필요하고, 아래를 실행합니다.

```sh
git clone https://github.com/NoLucas/Grok-Crew.git grok-crew
cd grok-crew
npm run local
```

브라우저 대신 창으로 쓰려면 `npm install` 한 번 후 `npm run desktop`입니다. 첫 실행은 몇 분 걸릴 수 있습니다. 끄려면 `Ctrl+C`.

이 컴퓨터에서 자신의 영상을 만들고 올리는 것은 가능합니다. 소스는 [BUSL-1.1](LICENSE)로 공개되어 있고, 오픈소스 제품은 아닙니다. 질문: [CONTRIBUTING.md](CONTRIBUTING.md).
