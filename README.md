# 小小心愿｜生日心愿单

响应式静态网页，使用 Supabase Postgres 保存心愿单和拍下状态。访客无需登录或填写信息；不同设备通过同一访客链接读取共享数据。

## 配置 Supabase

1. 在 Supabase 创建一个 Free 项目。
2. 在项目的 SQL Editor 运行本仓库的 `supabase-schema.sql`。数据表启用了 RLS，浏览器只能调用受限 RPC；管理密钥和拍下者匿名令牌只保存哈希。
3. 从项目 API 设置复制 Project URL 和 publishable key（旧项目可用 anon key），填入 `supabase-config.js`：

   ```js
   window.SUPABASE_CONFIG = {
     url: 'https://你的项目编号.supabase.co',
     anonKey: '你的公开 publishable / anon key'
   };
   ```

4. 提交并推送 `supabase-config.js`，GitHub Pages 会自动重新发布。

网页只应使用公开 publishable / anon key。**不要**把 `service_role` 或 secret key 写入前端代码、仓库或网页配置。管理权限由随机管理口令验证，数据库只存其 SHA-256 哈希。

## 演示路径

1. 创建心愿单并添加礼物。
2. 将访客链接发给朋友；在另一台设备打开，确认清单内容相同。
3. 朋友点击“拍下”，其它设备约 4 秒内同步状态；拍下该礼物的浏览器可撤销。
4. 心愿主通过管理链接修改/删除礼物，或标记已收到；访客端显示“已感谢”。

## 本地预览

配置 `supabase-config.js` 后，在项目目录运行 `python3 -m http.server 8000`，打开 `http://localhost:8000`。GitHub Pages 发布不需要构建步骤。

## 存储和边界

- `wishlists` 保存心愿单信息；`wishlist_items` 保存礼物与状态；`wishlist_admin_secrets` 只保存管理口令哈希。
- 未认证访客只能通过公开读取函数查看清单、拍下未拍下的条目，或凭本浏览器的匿名令牌撤销自己的拍下。页面每 4 秒轮询同步状态。
- 访客身份仍是匿名的；撤销拍下需要使用拍下时的同一浏览器和设备。清除该浏览器站点数据后，令牌丢失，心愿主可在管理页撤回状态。
- 旧版浏览器 `localStorage` 中的数据不会自动迁移；升级后创建的新心愿单会保存在 Supabase，可跨设备访问。
- Supabase Free 项目有用量额度，长期低活跃项目可能在一周无活动后自动暂停；暂停后需在 Supabase Dashboard 恢复项目。
- 本项目不包含账号、支付、物流或多人合送/分摊功能。
