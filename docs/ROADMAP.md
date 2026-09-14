# 從 MVP 到多產線平台

此文件是後續工程規劃，並非已完成能力清單。

## P1：首台客戶設備驗證

- 在目標 Ubuntu NVIDIA 主機完成 Compose smoke、CUDA、YOLO 真實樣本、VLM 模型相容性。
- 導入一條產線，建立按批次／時間／工件隔離的評估集與缺陷 taxonomy。
- 定義漏檢率、誤殺率、cycle time、人工複判比例、停機行為。
- 強化模型常駐、工作取消／恢復、DB migration、分頁、角色與專案分享、備份還原演練。
- 驗證 ONNX/TensorRT 與原生權重輸出一致性。

## P2：工業接入

- Camera Agent：USB/OpenCV、RTSP 重連、GigE/GenICam SDK、曝光／觸發、camera_id、frame_id、時間戳。
- Runtime 與 Studio 分離，Edge 端離線維持上一個有效模型；部署包簽章、下載確認、健康檢查與回滾。
- PLC adapter：Modbus/OPC-UA，明確握手、逾時、去重、fail-safe、工件追蹤，先 dry-run 再實體剔除。
- MES/MQTT/Webhook：outbox、retry、idempotency key、防止重複履歷與命令。

## P3：通用模型與 Workflow

- RT-DETR、異常偵測、OCR/Barcode、OpenCV 前處理、量測 adapter。
- Workflow Builder：有型別的 DAG，Camera→ROI→模型→規則→複判→決策。
- Schema 驗證、無循環、版本化、dry-run、耗時上限、每節點追蹤。
- VLM 說明與客觀判定分離；量測必須有像素比例／畸變校正及量測系統分析。
- 3D/Depth、SAM/CLIP/DINO 可透過 adapter 逐步增加。

## P4：50–100 台設備

- 設備註冊、憑證、heartbeat、軟體與模型版本、遠端部署批次與 canary。
- GPU resource scheduler、推論 batching、訓練隔離、觀測性及告警。
- PostgreSQL 正規化、分區、影像留存分級、角色稽核、企業 SSO。
- 以實際 camera resolution/frame rate/model/VRAM 計算容量，完成 24–72 小時 soak 與斷線／断電測試，再承諾規模。

## 驗收責任

工程負責功能、失敗策略與可追溯性；品質單位負責缺陷標準與漏檢／誤殺接受門檻；產線工程負責相機與 PLC 時序；IT 負責內網、帳號、備份與維運。任何新增實體剔除控制都需先使用模擬器驗證。
