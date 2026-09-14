# 預先放置權重

遷移學習（分類預設）：放入 `mobilenet_v3_small.pth`（torchvision `IMAGENET1K_V1` state dict），可用 `python scripts/fetch_weights.py` 產生。
姿勢專案：放入 `yolo11n-pose.pt`（Ultralytics YOLO11 姿勢模型，AGPL-3.0 授權，商業使用請確認授權），同一腳本可下載。
YOLO 訓練：放入 `yolo11n.pt`。程式只載入本地檔案，不自動下載。
VLM：將相容 vLLM 0.10.1 的完整 Vision 模型目錄放入 `vlm/`，例如已驗證的 Qwen2.5-VL 模型；須含 tokenizer、config、processor 與 safetensors。

權重不隨專案散布。請依模型授權取得；連網下載與容器建置請在受控建置環境完成，再移入工廠。
