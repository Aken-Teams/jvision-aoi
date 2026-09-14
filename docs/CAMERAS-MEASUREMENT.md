# 網路攝影機與簡易量測更新

## 網路攝影機

已新增手動指定的 RTSP/TCP 串流取樣與 HTTP/HTTPS 靜態快照。保留原有瀏覽器 USB Webcam。支援按鈕觸發單張擷取，以及建模畫面類別卡片「IP 相機 → 定時自動擷取」：設定間隔（最短 1 秒）與張數上限，前一張擷取並上傳完成後才進行下一張。不是持續錄影、ONVIF 掃描、PTZ 或高 FPS 串流播放器。每次擷取會重新建立連線，RTSP 單張最長約 12 秒，實際間隔可能大於設定值。瀏覽器網路攝影機（USB Webcam）同樣提供定時自動擷取，最短 0.2 秒。

自動擷取預設整次視為同一批次群組，避免靜止工件的近似影像同時進入訓練與測試集；輸送帶上每次為不同工件時，可勾選「每張視為獨立樣本」。

### 安裝

新安裝照 README 執行 `scripts/setup.py`。已安裝者先保留原有 `.env` 與 volumes，再執行：

```bash
python3 scripts/upgrade_camera.py
```

於 `.env` 填寫精確相機 IP（逗號分隔），例如：

```dotenv
CAMERA_ALLOWED_IPS=192.168.1.50,192.168.1.51
```

`CAMERA_GATEWAY_TOKEN` 由腳本產生；不要修改既有 `SECRET_KEY`，因相機 URL 使用此金鑰衍生的 Fernet key 加密。若更換金鑰，必須重新建立相機設定。

```bash
# CPU / 網路相機
 docker compose -f compose.yaml -f compose.camera.yaml up -d --build
# GPU / 網路相機
 docker compose -f compose.yaml -f compose.gpu.yaml -f compose.camera.yaml up -d --build
```

需要 VLM 可再加 `-f compose.vlm.yaml`。Camera Gateway 使用獨立一般 bridge 連接廠內相機，API/DB/Worker 保留原 internal network。Gateway 不公開 port，要求內部服務 token，API 與 Gateway 都檢查管理員相機 IP 清單。Gateway 必須有 LAN 路由；網路層可將其出口限制到相機 VLAN，避免攝影機服務引導其他網路連線。這是廠內相機接入，不是雲端辨識服務；原有「全部服務無出口」敘述僅適用未啟用相機 override 的基礎 Compose。

### 使用

1. 專案 → 即時測試 →「網路攝影機」。
2. 新增名稱與設備提供的 RTSP 路徑，例如 `rtsp://帳號:密碼@192.168.1.50:554/實際串流路徑`。不同品牌路徑不同，不會自行猜測。
3. 帳密含 `@`、`:`、`/` 等保留字元時，先做 URL percent-encoding。HTTP 端點為 JPEG/PNG 等單張圖，不是攝影機管理網頁或 MJPEG 串流；目前 HTTP 帳密支援 Basic，未支援 Digest/表單登入。
4. 儲存後按「擷取相機畫面」；成功即載入 Playground。
5. 按「執行檢測」，或選類別「加入資料集」。偵測專案仍须框選瑕疵。
6. 相機網址與帳密不會回傳列表；需要更換帳密時停用舊設定、重新新增。

RTSP 透過 FFmpeg TCP 取一張畫面，最長約 12 秒，取樣尺寸限制在 1920×1080 內並保持比例。HTTP 快照上限 20 MB、25 MP，不跟隨 redirect、保留 HTTPS 憑證檢查。錯誤不包含帳密。攝影機擷取尺寸可能與原始輸出不同，量測須對當次影像校正。

## 手動量測

即時測試載入影像後，展開「簡易尺寸量測」。

1. 選「校正線」，在同平面的已知尺寸兩端各點一次。
2. 輸入該線實際長度，例如 10 mm。
3. 選「手動量測線」，點選待量區段兩端。
4. 按「手動量距離」，顯示 mm；未完成兩點校正時只顯示 px。

公式：`pixels_per_mm = 校正線像素長 / 已知毫米長`；`量測長度_mm = 待測像素長 / pixels_per_mm`。校正線至少跨 5 px。點座標依影像實際解析度換算，不受網頁顯示縮放影響。

## 自動量測

1. 校正方式同上，若只需要 px 可省略。
2. 選 ROI 工具，在量測圖上拖曳框選。預設整張圖。
3. 選擇「深色物件／淺色背景」或相反極性，調整灰階閾值。
4. 按「自動量測長、寬、面積」。

演算法為灰階閾值分割、外輪廓擷取、最小面積旋轉外接矩形。長／寬取外接矩形兩邊；面積為外輪廓面積，內部孔洞不扣除。忽略小於 25 px² 與接觸 ROI 邊界的輪廓，最多回傳 20 個物件。找不到完整輪廓時明確回報錯誤，不生成假尺寸。

每次量測保存：原圖、mode、校正點及實際長度、ROI、閾值、極性、量測結果、建立者與時間。面板提供歷史結果與原圖連結。換圖／重新擷取相機畫面時清除校正，避免沿用不同縮放的比例。

此版為 2D 平面簡易估算。固定相機、同平面參考物、清楚輪廓與穩定光源才有可用結果；尚未包含鏡頭畸變校正、透視校正、3D 深度、公差判定與量測系統分析。顯示三位小數只是數值格式，不代表千分之一毫米精度。

## 新 API

| Method | Path | 用途 |
|---|---|---|
| GET/POST | /api/v1/projects/{pid}/cameras | 相機列表／新增 name、url |
| DELETE | /api/v1/cameras/{cid} | 停用設定 |
| POST | /api/v1/cameras/{cid}/capture | image/png 快照 |
| POST | /api/v1/projects/{pid}/measure | multipart file、config（JSON 字串） |
| GET | /api/v1/projects/{pid}/measurements | 量測紀錄 |
| GET | /api/v1/measurements/{mid}/content | 量測原圖 |

config 範例：

```json
{
  "mode":"automatic",
  "reference_points":[{"x":0.1,"y":0.1},{"x":0.3,"y":0.1}],
  "reference_mm":10,
  "roi":{"x":0,"y":0,"w":1,"h":1},
  "threshold":100,
  "polarity":"dark"
}
```

手動改為 `mode=manual` 並加 `points`（兩個 normalized x/y）。未校正可省略 reference 欄位。

## 驗證邊界

HTTP adapter 用真正的本地 HTTP 測試伺服器驗證 PNG 接收與拒絕 redirect；相機 API 已驗證網址加密、隱藏憑證、權限與停用狀態。RTSP subprocess 的成功與逾時以替身驗證，沒有實體 RTSP 攝影機，不能宣稱特定品牌已連線成功。

量測以已知像素尺寸的影像驗證手動距離、旋轉外接矩形長寬、面積、毫米校正、無效 ROI／校正拒絕及歷史保存。實際相機量測精度仍需現場校正驗收。前端正式建置通過；瀏覽器視覺點擊與 Docker 網路相機整合未在此環境實測。

參考：[FFmpeg RTSP 協定文件](https://ffmpeg.org/ffmpeg-protocols.html#rtsp)、[OpenCV 輪廓與矩形函式](https://docs.opencv.org/4.x/d3/dc0/group__imgproc__shape.html)。
