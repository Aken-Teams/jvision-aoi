# JVision AOI Studio — 專案需求與交付對照 v0.1

## 產品目標

讓沒有 Python 背景的工廠人員，以瀏覽器建立可追溯的 AOI 模型。平台保留影像、標註、訓練參數、版本、部署與每次檢測結果；不以 VLM 取代第一層視覺模型。部署目標為廠內 Ubuntu NVIDIA 伺服器。

## v0.1 使用者故事

- 操作員建立分類或偵測專案，定義 OK 與缺陷類別。
- 操作員批次上傳 PNG/JPG，選擇類別與批次群組。
- 操作員在內建工作室確認分類，或框選瑕疵位置；可使用已部署模型產生建議，仍須確認。
- 工程師選 Fast/Balanced/High Accuracy/Advanced，將工作放入單一 GPU 佇列。
- 工程師查看實際進度與錯誤、驗證／測試指標及版本，選擇部署或回滾。
- 操作員上傳或擷取 Webcam 單張影像，看到 PASS/FAIL/REVIEW，對不確定結果人工複判。
- 系統整合人員以 Bearer token 呼叫 REST 推論；所有結果帶版本識別。

## MVP 功能對照

| 原始項目 | v0.1 實作 | 交付狀態 |
|---|---|---|
| Project Management | 建立、列表、依使用者隔離，分類／偵測任務 | 實作並測試 |
| Dataset Upload | 批量／拖曳／API、PNG/JPG、重複內容阻擋、群組欄位 | API 已測試，互動待瀏覽器驗收 |
| OK/NG Classification | 真實 Logistic Regression 基準與 PyTorch CNN | 訓練與推論已測試 |
| YOLO Object Detection | 本地 YOLO 權重、標註轉換、訓練、val/test、推論、匯出 | 詳見 VALIDATION |
| Label Studio | 內建分類與 bounding box 工作室 | 不等同第三方 Label Studio 整合 |
| GPU Training Queue | Redis/RQ 單 worker、timeout、失敗狀態 | 真實 Redis/RQ 已測；GPU／容器整合待驗 |
| Training Dashboard | 真實百分比、epoch loss／val loss、log、error | API 與前端建置已測試 |
| Model Registry | immutable snapshot hash、參數、保留集指標、模型檔 | 已測試 |
| AOI Playground | 真實 REST 推論與結果 | HTTP 流程已測試 |
| Camera Test | 瀏覽器 getUserMedia → 擷取影像 → 推論 | 無實體相機，待驗 |
| REST API | 登入、專案、上傳、標註、訓練、部署、推論、履歷 | 已測試；OpenAPI 隨附 |
| VLM Secondary Inspection | 本地 OpenAI-compatible vision endpoint、原圖＋ROI、嚴格 JSON | Gateway 與失敗路徑已實作，模型服務待驗 |
| Docker Deployment | Frontend/API/Worker/PostgreSQL/Redis/MinIO、GPU/VLM override | Compose 設定已交付，無 Docker daemon 實測 |
| User/Login | Scrypt 密碼、HttpOnly session、Bearer、8 小時到期、登出撤銷、專案隔離 | API 已測試 |
| Inspection History | 原圖、主模型結果、VLM 結果、版本、時間、複判稽核 | 已測試 |

## 資料與訓練驗收規則

1. 每個專案必須包含 OK 類別，類別不重複。
2. 重複影像按正規化 PNG 的 SHA-256 阻擋。同一產品多角度／連拍應提供一致群組；未填群組時，以獨立內容 hash 為單位，不能自動識別近重複。
3. 偵測專案的 NG 影像必須有合法框；OK 影像不可含瑕疵框。框座標為 0–1 正規化 x/y/w/h。
4. 每次訓練複製當下影像與標註中繼資料，分割結果不可因後续改標而變動。
5. 分割按群組執行，約 70/15/15，seed=42；驗證集供 CNN 最佳 epoch 選擇，test 不參與訓練。
6. 指標為分類 macro precision/recall/F1、accuracy、confusion matrix；YOLO 使用官方 mAP/precision/recall 輸出。
7. 資料或依賴不足必須顯示錯誤，不可用隨機指標或假權重替代。

## 判定契約

- 分類標籤 OK 且分數達門檻 → PASS。
- 明確缺陷且分數達門檻 → FAIL。
- 分數不足、UNKNOWN、YOLO 未檢出框 → REVIEW；「未檢出缺陷」不等於確認良品。
- 啟用 VLM 時，只有 REVIEW 才送第二層。回應異常／超時保留 REVIEW。
- VLM 給出的 confidence 是模型自述分數，不是校準後機率。
- VLM 的 OK 預設無法直接放行；人工複判原始判定與結果分開存放。
- 無幾何校正與參考物，禁止宣稱 mm 尺寸；本次更新提供同平面比例校正的簡易 2D 量測，詳見 CAMERAS-MEASUREMENT.md。

## 非功能目標與限制

- Local Only：封閉 Compose 運行網路、本地模型權重；建置階段需網路或預載鏡像。
- 可還原：保存 DB、物件儲存、共享模型 volume；回滾只切換模型／政策指標，不刪除履歷。
- v0.1 聚焦單一伺服器、少量使用者、單張推論。尚未承諾 23 ms、100 cameras 或特定產線 throughput。
- 多租戶企業共享、RBAC、SSO、完整設備管理、容錯與高可用須下一階段。
