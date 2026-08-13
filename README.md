# Music Wave Alert

멜론 MUSIC WAVE의 확인·감지 팝업을 찾아 PC와 휴대폰으로 알려주는 Chrome 확장 프로그램입니다.

## 다운로드

**[Music Wave Alert v1.2.3 다운로드](https://raw.githubusercontent.com/Junho1224/musicwave-chrome-extension/main/release/music-wave-alert-extension-v1.2.3.zip)**

ZIP 파일을 받은 뒤 압축을 풀고 아래 순서대로 설치하세요.

## Chrome에 설치하기

현재 버전은 Chrome 웹 스토어에 등록되지 않았으므로 개발자 모드로 설치합니다.

1. 다운로드한 ZIP 파일의 압축을 풉니다.
2. Chrome 주소창에 `chrome://extensions`를 입력합니다.
3. 오른쪽 위의 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
5. `manifest.json` 파일이 들어 있는 폴더를 선택합니다.
6. Chrome 확장 프로그램 목록에 **Music Wave Alert 1.2.3**이 나타나는지 확인합니다.

설치 후 Chrome 확장 프로그램 메뉴에서 Music Wave Alert를 고정해두면 편리합니다.

## 기본 설정

1. 멜론 MUSIC WAVE 페이지를 엽니다.
2. Music Wave Alert 아이콘을 누릅니다.
3. **현재 탭을 감시하고 있습니다**가 표시되는지 확인합니다.
4. **PC 테스트 알림 보내기**를 눌러 알림이 오는지 확인합니다.
5. 필요한 알림 설정을 켠 뒤 MUSIC WAVE 페이지를 한 번 새로고침합니다.

계속 듣기 알림에서는 **이 탭 새로고침**을 사용할 수 있습니다. 기계적 스트리밍 감지 알림이 오면 MUSIC WAVE 탭에서 직접 인증해주세요.

**MUSIC WAVE 탭 종료 알림**을 켜두면 Chrome에서 마지막 MUSIC WAVE 탭을 닫거나 다른 주소로 이동했을 때 PC와 연결된 휴대폰으로 알려줍니다. Chrome 전체가 종료된 경우에는 알림을 보낼 수 없습니다.

## 휴대폰 알림 연결

연결 안내 페이지: <https://music-wave-alert-connect.ho1.chatgpt.site>

1. PC에서 Music Wave Alert 아이콘을 누릅니다.
2. **휴대폰 알림**을 켭니다.
3. **휴대폰 연결 만들기**를 누릅니다.
4. 화면에 표시된 QR 코드를 휴대폰으로 스캔합니다.
5. **ntfy 앱으로 받기** 또는 **앱 없이 웹으로 받기**를 선택합니다.
6. 휴대폰 알림 권한을 허용합니다.
7. PC로 돌아와 **휴대폰 테스트**를 누릅니다.

안정적인 알림을 원하면 ntfy 앱 방식을 권장합니다. 웹 방식은 Android 브라우저에서도 사용할 수 있으며, iPhone은 iOS 16.4 이상에서 Safari의 **홈 화면에 추가**를 사용해야 합니다.

테스트 알림이 도착하면 연결 안내 페이지는 닫아도 됩니다. QR 코드로 연결한 주소는 다른 사람에게 공유하지 마세요.

## 선택 팁: 탭별 볼륨 조절

[Volume Master](https://chromewebstore.google.com/detail/volume-master/jghecgabfgfdldnmbfkhmffcabddioke)를 사용하면 Chrome 탭마다 볼륨을 조절할 수 있습니다.

MUSIC WAVE 탭을 음소거하면 페이지 경고음도 들리지 않을 수 있으므로 PC 알림 또는 휴대폰 알림을 함께 켜두세요.

## 릴리즈

### v1.2.3

- 페이지 종료 직전 신호를 확인하는 직접 탭 종료 감지 추가
- 새로고침과 실제 탭 종료를 1.2초 후 재확인해 구분
- MUSIC WAVE 탭 감시 등록을 주기적으로 보강

### v1.2.2

- MUSIC WAVE 페이지와 백그라운드의 이중 탭 종료 감지 적용
- 열린 MUSIC WAVE 탭 ID를 직접 등록해 마지막 탭 종료 판별 강화

### v1.2.1

- 확장 프로그램 업데이트 후 첫 탭 종료를 놓치는 문제 수정
- 이미 열려 있는 MUSIC WAVE 탭을 자동으로 감시 상태에 등록

### v1.2.0

- 마지막 MUSIC WAVE 탭 종료 및 다른 주소 이동 감지
- PC와 연결된 휴대폰으로 탭 종료 알림 전송
- 탭 종료 알림에서 MUSIC WAVE 다시 열기 지원

### v1.1.1

- 실제 MUSIC WAVE 확인·감지 팝업 우선 감지
- 휴대폰 알림 전송 실패 시 제한된 자동 재시도
- 확장 프로그램에서 현재 감지 중인 경고 종류 표시

### v1.1.0

- ntfy 앱·웹을 이용한 휴대폰 알림 추가
- 사용자별 휴대폰 연결 QR 제공
- PC 알림과 휴대폰 알림 개별 설정 지원
