# Sori

[English](README.en.md)

녹음하고, 자르고, 다듬어서 내보내는 Windows용 멀티트랙 음성 편집기예요. 한국어 화면, 흔히 쓰는 단축키, 꼭 필요한
기능만 담았어요. 게임 · 애니메이션 보이스처럼 대사마다 파일 하나씩 납품하는 녹음을 위한 **대본 녹음 모드**와, AI가
터미널에서 프로젝트를 다룰 수 있는 **명령줄(CLI)** 이 있어요.

## 할 수 있는 것

- **멀티트랙 편집**: 클립 옮기기 · 나누기 · 자르기 · 합치기, 구간 삭제 · 남기기 · 무음 넣기, 클립 볼륨 · 페이드, 마커,
  빠르기(BPM) · 박자 격자. 모든 편집은 Ctrl+Z로 되돌릴 수 있어요
- **녹음**: 마이크 고르기, 카운트인, 메트로놈, 지연 자동 측정
- **효과**: 트랙 · 마스터에 항상 걸린 효과(EQ, 컴프레서, 디에서, 험 제거, 리버브, 에코)와 소리 자체를 바꾸는 효과
  (볼륨, 노멀라이즈, 페이드, 빠르기, 음높이, 잡음 줄이기…)
- **목소리 정리**: 한 번에 깔끔하게(잡음 · 웅웅거림 · 고르기 · 긴 침묵 줄이기 · 음량 맞추기)
- **대본 녹음 모드**: .txt / .csv / .xlsx 대본을 넣으면 대사마다 테이크를 녹음하고 ★로 고른 테이크를 대사별 파일로 내보내요.
  여러 대사를 길게 한 번에 녹음하고 대사별로 나눌 수도 있어요
- **내보내기**: WAV(16/24bit), MP3(128/192/320kbps) — 전체, 구간, 트랙만, 마커 구간별, 대사별
- **안전장치**: 자동 저장과 꺼졌을 때 복구, 프로젝트마다 최근 10개 자동 백업
- **AI용 명령줄**: 앱을 켜지 않고 `.vproj`를 고치거나, 켜 둔 앱을 그대로 조작해요 (`sori live …`). 결과는 언제나 JSON 한 줄

## 설치

Windows 10/11 (64비트). [Releases](https://github.com/ytl001G/sori/releases/latest)에서 `Sori Setup <버전>.exe`를 받아
실행하세요. 설치 파일에 코드 서명이 없어서 처음 실행할 때 Windows가 'Windows의 PC 보호' 창을 띄울 수 있어요. 그러면
**추가 정보 → 실행**을 누르세요.

## 소스에서 실행

필요한 것:
- Windows 10/11 (64비트)
- [Node.js](https://nodejs.org) 22.12 이상 (npm이 함께 깔려요)
- [Git](https://git-scm.com) (또는 GitHub의 Code → Download ZIP)
- 인터넷 연결: 처음 `npm install`과 처음 `npm start` 때만. 앱 자체는 인터넷을 쓰지 않아요
- 디스크 약 600MB (라이브러리 약 230MB + 처음 켤 때 받는 Electron 약 360MB)

```
git clone https://github.com/ytl001G/sori.git
cd sori
npm install
npm start          # 앱 실행 (처음 한 번은 Electron을 받느라 조금 걸려요)
npm test           # 편집 · 효과 · 파일 형식 자체 검사 (Node만)
npm run smoke      # 앱을 띄워 가져오기 → 편집 → 효과 → 내보내기 → 저장까지 자동으로 확인
npm run dist       # Windows 설치 파일을 dist/에 만들기 (처음엔 만드는 도구를 받느라 인터넷 필요)
```

## AI용 명령줄

```
node src/cli/sori.js --help
node src/cli/sori.js info 프로젝트.vproj
node src/cli/sori.js apply 대본.vproj voiceClean --all-lines
node src/cli/sori.js live state          # 켜 둔 앱의 지금 상태
```

자세한 사용법: [docs/cli.md](docs/cli.md)

## 문서

| 문서 | 내용 |
|---|---|
| [docs/spec.md](docs/spec.md) | 기능 명세 |
| [docs/architecture.md](docs/architecture.md) | 모듈, 데이터 구조, 파일 형식 |
| [docs/ui-guide.md](docs/ui-guide.md) | 화면 배치, 디자인, 조작 |
| [docs/cli.md](docs/cli.md) | 명령줄 사용법 |

## 개인정보

Sori는 인터넷에 연결하지 않아요. 녹음, 프로젝트, 설정, 자동 저장, 백업은 모두 내 컴퓨터에만 있어요
(설정 · 자동 저장 · 백업은 `%APPDATA%\Sori`). 어떤 정보도 모으거나 보내지 않아요.

## 라이선스

[MIT](LICENSE). 함께 들어 있는 라이브러리(MP3 인코더 lamejs, 빠르기 · 음높이 soundtouchjs 등)는 각자의 라이선스를
따라요: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

소프트웨어는 "있는 그대로" 제공되며 어떤 보증도 하지 않아요. 중요한 녹음은 따로 보관해 주세요.
