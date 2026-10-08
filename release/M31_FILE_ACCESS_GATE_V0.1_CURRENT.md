# M31.5 文件授权网关 · STAGING GATE V0.1 CURRENT

日期：2026-10-08
结论：**代码 + 独立 MySQL / S3 模拟契约 CI PASS；Staging 服务部署 SUCCESS；线上匿名鉴权 PASS。真实文件正向打开 E2E = HOLD**。Production 0 变更。

## 已实现

- 资产版本文件读取 GET `/api/runtime/projects/:projectId/assets/:assetId/versions/:versionId/access`。
  - Runtime 每次校验 `project:read` 及 tenant/workspace/project 范围，必须为项目自有资产与 PROJECT 资产库。
  - 需要资产库与资产均明确 `fileReadAllowed=true`，QA PASS、ACTIVE/CURRENT 等正式状态，以及权利与用途约束。
  - 仅接入明确 `contentLocator.provider='S3_COMPATIBLE'` 的正式版本；其他来源引用返回阻断码。
  - 对象 key 前缀必须严格为 `tenantId/workspaceId/projectId/assetId/versionId/`；绑定版本指纹必须为 SHA-256。
  - 后端使用服务器端 S3 SigV4 签名，对对象执行 HEAD，返回本站 `/content` 路径；**不返回 S3 私有 URL 或凭据**。
- `GET .../content` 再次走权限校验与 GET；流式读取最多 20 MiB，校验 MIME/响应长度/SHA-256，审计成功后才返回附件。失败全部拒绝。
- `audit_logs` 记录 FILE_ACCESS_GRANTED / FILE_ACCESS_DENIED；Runtime 原有 `authorization_decisions` 记录 scoped RBAC 决策。审计不可写不得提供文件。
- 前端 BFF 只允许精确 asset-version access/content GET；仅用户个人 scoped 会话允许，预发共享管理员只读模式**不能打开文件**。二进制代理有大小限制与附件下载头。
- 前端只针对标记为 S3_COMPATIBLE 的真实版本显示“验证文件授权”；/access 返回 READY 后才创建下载入口。

## 实测和部署

- 后端隔离 CI `37731945400` PASS，包含真实 ephemeral MySQL 的项目和审计测试、S3 签名、跨项目拒绝、权利/QA 阻断、篡改 SHA-256、文件大小、缺存储配置与审计失败。
- 前端代码/浏览器 CI `37731813987` PASS；服务器凭据不在客户端，受限 BFF 文件路由有自动化测试。
- Staging Console Railway deployment `48ab1d6c-efac-4a8c-b752-4c80822e60fb` SUCCESS；Runtime deployment `7d65ddf5-4edb-4694-9707-1493ce75bde8` SUCCESS；Staging MySQL SUCCESS。
- Staging bucket `m31-asset-read-staging` 已仅在 staging 创建，Railway S3 endpoint `https://t3.storageapi.dev`，region `auto`，访问方式 virtual-host。**密钥通过 Railway reference variables 注入，不写入源码**。
- GitHub Actions 真实 HTTP `37732093238` PASS：/ready=200、工作台会话匿名且写入关闭、匿名 /access 和 /content 都 401。在线路由可达，但这不证明 S3 文件内容存在。

## 标准受控资产迁入条件

必须使用完整实际文件和真实源哈希写入桶，才允许将版本记录关联至该对象。示例元数据仅作字段合同，不代表实际存在的文件：

```json
{
  "provider": "S3_COMPATIBLE",
  "objectKey": "<tenantId>/<workspaceId>/<ownerProjectId>/<assetId>/<versionId>/<filename>",
  "mimeType": "application/pdf",
  "filename": "approved-qa.pdf"
}
```

必须同时记录已验证的 `fingerprintSha256`（真实文件 SHA-256）、`permissionPolicy.fileReadAllowed=true`、`rightsPolicy.fileReadAllowed=true`、`asset.rights.fileReadAllowed=true` 和 `qaResult.status='PASS'`。历史 PROJECT_LIBRARY 或 ChatGPT Library 引用不能直接充当 S3 实体，不得为了连通而伪造资产、指纹或权利许可。

## Remaining HOLD

1. 提供一个真实、可授权的 Staging 资产版本样本，迁入桶并确认原始文件 SHA-256、权益批准和 Runtime 数据绑定。
2. 凭实际个人 scoped 凭据，浏览器完成 /access HEAD→/content GET 正向 E2E、审计回读、权限撤销和跨空间负向测试。
3. Google Drive OAuth provider 及 PRD/QA 文档独立 resolver 尚未接通；不得冒用 ChatGPT 插件授权。
4. 20 MiB 上限之外的大视频需要单独的分段/流式策略；不可自动扩大内存限额。
5. 正式生产身份管理/SSO、多实例会话、配额/防滥用与安全复核。禁止生产晋级。

**无真实文件正向 E2E 前，File OPEN Gate = HOLD。**
