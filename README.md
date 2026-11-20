# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rawacana2024-del/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rawacana2024-del/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: ranks pre-token DeFi protocols by the implied value of their future token, each with concrete farm steps, in a static no-network dashboard. The value model is derived from the sealed DefiLlama snapshot itself (TVL, 7-day growth, age with no token, and FDV/TVL multiples measured from protocols whose tokens already trade).

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads the sealed snapshot at `/input/snapshot.json` and writes `board.json`, the dashboard data, the dashboard, the screenshots, and `dossier.json` to the output directory.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
