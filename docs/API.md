# REST API

Base path：`/api/v1`。完整 schema：`openapi.json`；服務啟動後為 `/api/v1/openapi.json`。

所有資料端點均要求 session cookie 或 `Authorization: Bearer <token>`。使用 `/login` 回傳 token。Token 效期 8 小時，`/logout` 撤銷此使用者現有 token。API 不接受跨使用者專案。

| Method | Path | 功能 |
|---|---|---|
| GET | /health | 服務健康 |
| POST | /login | JSON username/password |
| POST | /logout | 登出、撤銷 token |
| GET | /me | 登入身分 |
| GET/POST | /projects | 清單／建立；選填 adapter 為專案預設模型類型 |
| PATCH | /projects/{pid} | 專案改名 |
| GET | /projects/{pid}/archive | 匯出專案檔 zip（類別、樣本、群組、標註；不含模型） |
| POST | /projects/import | multipart file：匯入專案檔，建立新專案 |
| GET | /projects/{pid}/overview | 專案、影像、工作、模型、部署、履歷 |
| POST | /projects/{pid}/classes | 新增類別 name |
| PATCH | /projects/{pid}/classes/{name} | 類別改名，同步影像與框選標籤；OK 不可改 |
| DELETE | /projects/{pid}/classes/{name} | 刪除類別；仍有影像時 409，需 `with_images=true` |
| POST | /projects/{pid}/images | multipart file、label、group |
| GET | /images/{iid}/content | 讀取影像 |
| DELETE | /images/{iid} | 軟刪除影像（保留 blob 供既有訓練快照追溯） |
| PUT | /images/{iid}/annotation | label、boxes、reviewed |
| POST | /projects/{pid}/images/{iid}/suggest | 已部署模型輔助標註，不自動保存 |
| POST | /projects/{pid}/train | adapter（transfer/baseline/cnn/yolo）、mode、epochs、batch_size、learning_rate |
| POST | /projects/{pid}/deploy | model_id、threshold、vlm_enabled、vlm_can_pass |
| POST | /projects/{pid}/rollback/{did} | 切換到歷史部署 |
| GET | /models/{mid}/export | format=native/onnx/engine；依 adapter 支援 |
| POST | /inference | multipart project_id、file；選填 model_id |
| POST | /projects/{pid}/preview | multipart file；選填 model_id。即時預覽分數，不存影像、不寫履歷、不做 PASS/FAIL |
| GET | /inspections/{iid}/content | 原始檢測影像 |
| POST | /inspections/{iid}/review | decision PASS/FAIL、note |
| POST | /demo | 建立 60 張合成影像 Demo |

## 範例

建立專案：

```json
{"name":"MLCC 外觀","task":"detection","labels":["OK","scratch","crack"]}
```

標註座標以影像左上角為原點，0–1 normalized：

```json
{"label":"scratch","reviewed":true,"boxes":[{"label":"scratch","x":0.2,"y":0.3,"w":0.4,"h":0.1}]}
```

訓練：

```json
{"adapter":"yolo","mode":"advanced","epochs":30,"batch_size":16,"learning_rate":0.001}
```

推論（不提供 model_id 時使用 active deployment，提供則為 Playground 單模型測試，無 VLM）：

```bash
curl http://localhost:3000/api/v1/inference \
  -H "Authorization: Bearer TOKEN" \
  -F "project_id=PROJECT_ID" \
  -F "file=@image.png"
```

回傳格式示意，數值非產品性能保證：

```json
{
  "id":"inspection-uuid",
  "result":"REVIEW",
  "model_id":"model-uuid",
  "deployment_id":"deployment-uuid",
  "primary":{"label":"scratch","confidence":0.63,"boxes":[]},
  "secondary":{"decision":"REVIEW","confidence":0.0,"reason":"未設定本地 VLM 服務"},
  "latency_ms":120.5,
  "review":null
}
```

錯誤碼：401 未登入；403 權限／Origin 拒絕；404 不存在；409 重複影像、工作衝突或未部署；413 影像過大；422 資料不合法／adapter 不相容；429 登入暫時鎖定；503 推論或佇列不可用。

PLC/MES 整合端必须将 4xx/5xx、超時及 REVIEW 視為需停等／人工处理，不可當 PASS。本版不發送任何實體剔除命令。

新增網路相機與量測端點，見 `CAMERAS-MEASUREMENT.md`；完整 schema 已更新於 `openapi.json`。
