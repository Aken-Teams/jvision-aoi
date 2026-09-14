# JVision AOI Studio

給製造業操作員的廠內 AI 視覺檢測工作站。繁體中文介面，使用流程：**建立專案 → 上傳 → 分類／框選 → 訓練 → 測試 → 部署 → 留存履歷**。

這是 v0.1 可執行 MVP 原始碼，並非 50–100 相機量產驗證版本。CPU 分類、PyTorch CNN、權限、真實 Redis/RQ 佇列與推論流程已於交付環境執行測試；Docker/NVIDIA/實體相機與真實 VLM 的驗收狀態請見 `docs/VALIDATION.md`。另附 `demo-dataset/` 的 60 張影像可手動上傳。不提供虛構訓練進度、預設準確率或假模型結果。

## 本次更新：網路攝影機與簡易量測

已加入 RTSP／HTTP 快照、手動兩點量測、自動輪廓長寬／面積與當張影像 mm 校正。使用與升級說明見 `docs/CAMERAS-MEASUREMENT.md`。網路相機需加入 `compose.camera.yaml`，不是僅啟動基礎 Compose。

## 快速安裝：Ubuntu Server + Docker Compose

主機須具備 Docker Engine、Compose v2；GPU 模式另須 NVIDIA driver 與 NVIDIA Container Toolkit。所有服務均有容器設定。建置需取得套件與基底映像；運行時 Compose 使用 internal network，原始影像不上傳雲端。

```bash
unzip JVision-AOI-Studio-v0.1.zip
cd jvision-aoi
python3 scripts/setup.py
```

開啟 `.env`，記下或自行修改 `ADMIN_PASSWORD`。其他密鑰由腳本隨機建立。不要將 `.env` 納入版本庫。

CPU 流程驗證（免下載深度學習套件）：在 `.env` 設 `INSTALL_AI=false`。

```bash
docker compose up -d --build
docker compose ps
```

在伺服器本機開啟 `http://localhost:3000`，帳號為 `admin`，密碼為 `.env` 內的值。遠端電腦可用 SSH tunnel：

```bash
ssh -L 3000:127.0.0.1:3000 username@SERVER_IP
```

再於遠端電腦瀏覽器開啟 `http://localhost:3000`。此方式也可使用瀏覽器 USB/Webcam。

廠內多使用者正式入口：以公司 HTTPS reverse proxy 指向本機 3000；設定 `.env` 的 `PUBLIC_ORIGIN=https://aoi.company.example` 與 `COOKIE_SECURE=true`。若直接開放 LAN HTTP，需設定 `BIND_ADDRESS=0.0.0.0`、`PUBLIC_ORIGIN=http://SERVER_IP:3000` 並由防火牆限制存取；瀏覽器相機通常不允許此種 HTTP 位址。

### 啟用 GPU / CNN / YOLO

在 `.env` 設 `INSTALL_AI=true`。YOLO 初始權重須預先放入 `weights/yolo11n.pt`；CNN 從頭訓練，不須外部權重。

```bash
nvidia-smi
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
docker compose -f compose.yaml -f compose.gpu.yaml exec worker python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

GPU worker 預設一個程序、一次執行一個工作。API 與 worker 共享 GPU，訓練與生產同時運行可能互相競爭 VRAM；量產時應分配獨立 GPU 或分離訓練／推論伺服器。不要直接橫向增加 worker 搶同一張 GPU。

### 完整 Demo

1. 登入後按「建立示範資料」：實際產生並儲存 60 張合成表面影像，OK/NG 各 30 張。
2. 開啟專案 → 模型訓練 → CPU 基準分類器 → 開始訓練。
3. 狀態從 queued → running → completed；版本庫出現真實保留集指標。
4. 模型版本 → 測試 → 上傳影像，或從相機擷取後執行檢測。
5. 部署管理 → 選擇版本與門檻 → 啟用部署。
6. 在即時測試選「目前部署」，推論使用部署規則；歷史保留模型 ID、部署 ID、影像與人工複判紀錄。
7. 可重新訓練、切換部署，再回滾舊版。

每類至少 5 個獨立影像／批次群組；資料以約 70/15/15 分割，小樣本因取整略有不同。Demo 是流程驗證資料，不能當作工業精度證明。模型分數低於 0.85 時出現 REVIEW 是正常行為。

### 本地 VLM

將相容 vLLM 版本的完整視覺模型置於 `weights/vlm/`，再加入 optional compose：

```bash
docker compose -f compose.yaml -f compose.gpu.yaml -f compose.vlm.yaml up -d --build
```

VLM Gateway 發送原圖與最多 3 個 ROI，解析嚴格 JSON；只有管理員允許的本地主機可連線。部署勾選 VLM 才啟用。**未設定／連線失敗／無效 JSON／低信心 → REVIEW**。VLM 判 OK 預設不能自動 PASS，判 NG 且達門檻可 FAIL。此服務需要足夠 VRAM；模型與 vLLM 相容性須在目標主機驗收。雲端供應商未開放，以維持 Local Only。

## 開發與測試

Python 3.11/3.12、Node 22。

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt pytest
# CNN/YOLO 開發另裝 requirements-ai.txt
python -m pytest tests -q
# optional：pip install redislite
# TEST_REDIS=1 python -m pytest tests -q -k real_redis_queue
# TEST_YOLO=1 python -m pytest tests/test_yolo.py -q
```

本地 SQLite／檔案儲存僅為開發模式，Compose 則使用 PostgreSQL／MinIO／Redis。

在專案根目錄啟動後端：

```bash
export ADMIN_PASSWORD='your-own-long-password'
python scripts/run_local.py
```

另開終端：

```bash
cd frontend
npm ci
npm run dev
```

開發模式 `SYNC_TRAIN=true` 在 API 程序內訓練，只有 CPU 開發使用；正式 Compose 強制 Redis/RQ 佇列。

```bash
cd frontend
npm run build
npm run typecheck
```

容器端到端驗收：於根目錄載入自行建立的 `.env` 後執行。請只載入自己管理的環境檔。

```bash
set -a
. ./.env
set +a
python scripts/smoke.py
```

腳本將透過 HTTP 登入、建立 Demo、排入 RQ、等待訓練、部署並推論。它會建立一個新專案。

## 帳號、資料與備份

新增操作員：`docker compose exec api python -m app.manage operator01`，依提示輸入密碼。各使用者專案隔離，v0.1 尚未提供共享專案與角色細分。

Docker volumes：`postgres-data` 保存中繼資料；`minio-data` 保存影像與模型備份；`aoi-data` 保存 Runtime 可載入的模型及快照；`redis-data` 保存工作佇列。備份時停止 worker 與寫入作業，再一併備份 PostgreSQL、MinIO、aoi-data 和 `.env`。**不要執行 `docker compose down -v`，除非確定要刪除資料。**

查看錯誤：`docker compose logs --tail=100 api worker`。模型失敗會顯示 error，不會生成假的成功版本。Worker 非正常中斷後若工作仍顯示 running，需透過 RQ 檢查並標記；自動重試／完整工作取消尚未實作。

## 文件與邊界

- `docs/PRD.md`：需求、範圍與功能對照。
- `docs/ARCHITECTURE.md`：系統／資料／判定架構。
- `docs/API.md`、`docs/openapi.json`：API 與回傳欄位。
- `docs/VALIDATION.md`：實測紀錄、未驗項目、產線驗收。
- `docs/ROADMAP.md`：多相機、工業整合與後續模型。

尚未交付：第三方 Label Studio 服務（此版使用內建框選工作室）、GigE SDK／ONVIF 自動探索、PLC/MES 寫入、視覺拖曳 Workflow Builder、RT-DETR/Anomaly/OCR adapter、Jetson 自動部署、多相機設備管理。不可把這些規劃項目視為已完成按鈕。

## 套件來源

YOLO 訓練／標註格式依 [Ultralytics 官方文件](https://docs.ultralytics.com/modes/train/)，容器前端依 [Next.js Self-hosting](https://nextjs.org/docs/app/guides/self-hosting) 的 standalone 方式。專案固定 dependency 版本以利重現；升級前需重跑驗收。Ultralytics、模型權重與其他依賴各有自身授權，商業散布前依實際採用方式確認；此專案不附第三方權重。
