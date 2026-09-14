# 網路相機與量測更新

本次完整測試為 18 passed、2 opt-in skipped；手動／自動量測 4 項測試另已通過，前端 production build 通過。新增功能、測試範圍與部署網路變更請見 `CAMERAS-MEASUREMENT.md`；最新測試輸出為 `camera-measurement-tests.txt`。以下為初版驗證紀錄，原文中的 RTSP 尚未實作與不支援量測已由本次更新取代；實體設備與瀏覽器限制仍適用。

# 驗證紀錄 — 2026-09-14

## 已完成的實際驗證

| 項目 | 結果 | 範圍 |
|---|---|---|
| 後端核心測試 | 10 passed | 真實 CPU 訓練／推論、CNN、ONNX、權限、登入登出、分割、標註、VLM contract |
| YOLO adapter | 1 passed，約 64 秒 | YOLO11n 隨機初始化、本地合成資料、CPU 1 epoch、val/test、predict、ONNX export |
| 真實 Redis/RQ | 1 passed | 啟動 Redis TCP 程序，HTTP 建立 queued 工作，SimpleWorker 執行，狀態 completed，模型登錄 |
| 正式前端建置 | 通過 | Next.js 15.5.12 production build、TypeScript 檢查、靜態頁產生 |
| 真實 HTTP 串接 | 通過 | 啟動前端與 FastAPI，經 Next.js 代理登入→建立 Demo→訓練→部署→推論→履歷 |
| CNN ONNX | 通過 | 匯出 ONNX，ONNX Runtime 執行並與原生分類 argmax 一致 |
| 模型下載 | 通過 | 原生 ZIP 含權重／labels／manifest，非只回傳一個無 metadata 的 CNN 權重檔 |
| Compose 文件 | YAML 解析通過 | 主檔、GPU override、VLM override；非 Docker 實際啟動驗證 |

核心測試預設略過兩項 opt-in：YOLO 與 Redis，但兩者已另外執行通過。詳細輸出為 `test-results.txt`、`yolo-test-results.txt`、`redis-test-results.txt`；實測環境版本在 `test-environment.json`。

VLM contract 測試使用模擬 HTTP 回應，驗證合法 NG JSON、非法格式、超時及公網拒絕；**没有執行真實 VLM 權重**。CNN 與 YOLO 則是實際模型執行，不是 mock。

合成分類 Demo 的保留集可得到 1.0 指標，原因是人工生成任務非常簡單。此數字不可作為客戶案例、真實 AOI 精度或模型泛化證據。HTTP smoke 在預設 0.85 門檻出現 REVIEW，表示低信心保守規則正常運作。

## 未能驗證的部分

- 交付環境沒有 Docker CLI/daemon：未實際 pull/build/up 全部 Compose 服務，PostgreSQL、MinIO 容器持久化與 volume 權限需目標主機驗收。
- 沒有 NVIDIA GPU：未驗证 CUDA／driver／VRAM／TensorRT／訓練與推論資源競爭。
- 瀏覽器無法連入此環境本地 URL；本地瀏覽器下載亦受限。未完成桌面／手機的視覺與點擊驗收，不宣稱介面已實機測過。
- 沒有 USB/GigE 相機、PLC/MES：相機權限與擷取待驗；GigE/RTSP/PLC/MES adapter 尚未實作。
- 未提供實際工業資料與 VLM 權重：無法驗證真實瑕疵精度、漏檢率、VLM 語意判斷。
- Redis 測試為單機 SimpleWorker；容器 rq worker 的 fork、GPU context、異常中止恢復與多程序競爭仍待部署驗收。

## 目標伺服器必要驗收

1. 依 README 建置，確認服務健康，使用 `scripts/smoke.py` 完成完整 Compose HTTP 路徑。
2. 容器中 `torch.cuda.is_available()` 必須為 True，再測 CNN/YOLO 訓練。
3. 使用瀏覽器完成：建立專案、批次上傳、變更分類、拖曳框選、儲存、訓練、版本、測試、部署、回滾、人工複判。
4. 桌面／手機確認文字、表單與捲動；Webcam 需 HTTPS 或 localhost。
5. 以獨立批次真實樣本評估漏檢、誤殺、review rate；門檻由品質單位確認。
6. 真實 VLM：正常、超時、服務關閉、錯誤 JSON 都走預期流程；未設定時不可誤 PASS。
7. 重啟容器後，驗證帳號、影像、模型與歷史仍可讀；實際執行完整備份與還原。
8. 測試磁碟滿、GPU OOM、worker 終止、推論錯誤時的產線停等策略。

v0.1 是可執行 MVP 交付，尚未完成量產驗收。任何 50–100 相機、毫秒級 cycle time 或自動剔除承諾都不在本次實測結論中。
