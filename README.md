# hana-market

하나 패밀리 파티(PWA) 홈 화면의 **마켓 브리핑** 탭이 읽는 데이터 저장소예요.

- 파일은 `market.json` 하나예요. 게임은 열 때마다 아래 주소에서 최신 파일을 받아오고, 못 받으면 게임 안에 들어 있는 데이터로 보여줘요.
  `https://raw.githubusercontent.com/tactical7604-gif/hana-market/main/market.json`
- 화~토 아침(한국시간)에 Claude 예약 작업이 전날 코스피·코스닥과 새벽에 끝난 미국장을 정리해서 이 파일만 바꿔요.
- 내용: 지수와 1개월 차트, 급등·급락 종목과 이유 3줄, 놓치면 안 될 정보, 증권사 전망, 국내·해외 뉴스 분위기, 투자자별 수급.
- 올리기 전에 `python3 tools/validate.py market.json`으로 형식을 검사해요.

> Claude가 뉴스와 증권사 자료를 읽고 정리한 참고용 정보예요. 투자 권유가 아니에요.
