# REST API

Base path：`/api/v1`。完整 schema：`openapi.json`；服務啟動後為 `/api/v1/openapi.json`。

所有資料端點均要求 session cookie 或 `Authorization: Bearer <token>`。使用 `/login` 回傳 token。Token 效期 8 小時，`/logout` 撤銷此使用者現有 token。API 不接受跨使用者專案。

| Method | Path | 功能 |
|---|---|---|
| GET | /health | 服務健康 |
| POST | /login | JSON username/password |
| POST | /logout | 登出、撤銷 token |
| GET | /me | 登入身分 |
| GET/POST | /projects | 清單／建立；task 可為 classification／detection／audio／pose；選填 adapter、pass_labels（音訊／姿勢的合格類別）、pose_mode（static／sequence） |
| PATCH | /projects/{pid} | 專案改名、ROI、pass_labels（音訊／姿勢） |
| DELETE | /projects/{pid} | 移到垃圾桶（軟刪除）：樣本、模型、部署與檢測履歷保留，檢測 App 暫停 |
| GET | /projects/trash | 已刪除專案清單（新到舊） |
| POST | /projects/{pid}/restore | 從垃圾桶還原專案 |
| GET | /projects/{pid}/archive | 匯出專案檔 zip（類別、樣本、群組、標註；不含模型） |
| POST | /projects/import | multipart file：匯入專案檔，建立新專案 |
| GET | /projects/{pid}/overview | 專案、影像、工作、模型、部署、履歷 |
| POST | /projects/{pid}/classes | 新增類別 name |
| PATCH | /projects/{pid}/classes/{name} | 類別改名，同步影像與框選標籤；OK 不可改 |
| DELETE | /projects/{pid}/classes/{name} | 刪除類別；仍有影像時 409，需 `with_images=true` |
| POST | /projects/{pid}/images | multipart file、label、group；音訊為 WAV（自動轉 16 kHz、1 秒），姿勢動作專案為重複的 file 欄位（連續影像） |
| GET | /images/{iid}/content | 讀取影像 |
| DELETE | /images/{iid} | 軟刪除影像（保留 blob 供既有訓練快照追溯） |
| GET | /images/{iid}/thumbnail · /inspections/{iid}/thumbnail | 縮圖：影像、音訊頻譜圖、姿勢骨架 |
| PUT | /images/{iid}/annotation | label、boxes、reviewed |
| POST | /projects/{pid}/images/{iid}/suggest | 已部署模型輔助標註，不自動保存 |
| POST | /projects/{pid}/train | adapter（transfer/baseline/cnn/yolo）、mode、epochs、batch_size、learning_rate |
| POST | /projects/{pid}/deploy | model_id、threshold、vlm_enabled、vlm_can_pass |
| POST | /projects/{pid}/rollback/{did} | 切換到歷史部署 |
| GET | /models/{mid}/export | format=native/onnx/engine；依 adapter 支援 |
| POST | /inference | multipart project_id、file；選填 model_id。音訊取最後 1 秒；姿勢未偵測到人體時為 REVIEW；判定依專案合格類別 |
| POST | /projects/{pid}/pose/detect | 姿勢專案：multipart file，只回傳 COCO-17 關節點 `keypoints`（無人體為 null）與 latency_ms；不需模型、不存檔，供收集樣本時顯示即時骨架 |
| POST | /projects/{pid}/preview | multipart file；選填 model_id。即時預覽分數，不存影像、不寫履歷、不做 PASS/FAIL |
| GET | /inspections/{iid}/content | 原始檢測影像 |
| POST | /inspections/{iid}/review | decision PASS/FAIL、note |
| POST | /demo?kind=image\|audio\|pose | 建立合成示範專案（影像、馬達聲、姿勢） |

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

## 檢測 App（runtime API）

管理（Studio 登入）：`GET/POST /api/v1/projects/{pid}/apps`（建立時回傳一次性 `access_code`）、`PATCH /api/v1/apps/{aid}`（`name`、`alert_sound`、`regenerate_code`）、`DELETE /api/v1/apps/{aid}`（停用）。

操作員（存取碼 session 或 Bearer，僅限該 App）：

| Method | Path | 功能 |
|---|---|---|
| POST | /api/runtime/{slug}/login | JSON code；連續錯 5 次鎖定 5 分鐘 |
| POST | /api/runtime/{slug}/logout | 登出 |
| GET | /api/runtime/{slug}/config | App、專案類別與合格類別、目前部署（版本、門檻）、IP 相機 |
| POST | /api/runtime/{slug}/preview | multipart file；即時預覽，不寫履歷 |
| POST | /api/runtime/{slug}/inspect | multipart file、mode=single／continuous；使用目前部署並寫入履歷（標記 app_id） |
| GET | /api/runtime/{slug}/inspections | 今日統計與最近結果（僅此 App） |
| GET | /api/runtime/{slug}/inspections/{iid}/thumbnail · content | 檢測縮圖與原始樣本 |
| POST | /api/runtime/{slug}/inspections/{iid}/review | 人工複判 PASS／FAIL |
| POST | /api/runtime/{slug}/cameras/{cid}/capture | IP 相機擷取 |

Studio 的登入 token 不能呼叫 runtime API，App token 也不能呼叫 `/api/v1`。
