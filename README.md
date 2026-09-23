# 楚汉弈局

## 棋规来源与验证

棋规使用 [lengyanyu258/xiangqi.js](https://github.com/lengyanyu258/xiangqi.js)，固定提交
`f9019ac2303d4b80ef0b82fd0515bfb55a80a62b`（0.5.2-dev）。源码、BSD-2-Clause
许可证及修改说明位于 `src/vendor/xiangqi/`，发布包也包含 `xiangqi-LICENSE.txt`。
上游源码仅追加 ESM 导出；上游测试仅替换测试运行器导入，断言保持原样。

应用使用合法走法与将军判断；将死、困毙均判当前行棋方负，不启用上游简化的
重复局面、步数和子力和棋判断。内部坐标采用 ICCS 的 a0–i9（行号为 9-row）。

验证记录：91 项上游启用测试、17 项本地与适配测试通过；TypeScript 和生产构建通过。
Browser 实测通过普通走棋、炮吃马、悔棋及重新开始。上游注释掉的测试未启用，
不将其计入覆盖范围。数据库模拟器测试已提供，但本次环境缺少 Java/Firebase CLI，
该项未运行；真实跨设备对战未联调（未配置 Firebase）。

运行双客户端模拟器测试：安装 Java 21+ 和 Firebase CLI 后执行：

```powershell
firebase emulators:exec --only database --project demo-xiangqi "npm test -- tests/firebase-emulator.test.ts"
```

该测试使用两个模拟身份，验证创建与加入、订阅同步、普通走棋序列化、过期版本拒绝
及非法走法拒绝；不访问生产数据库。普通 `npm test` 在没有模拟器地址时跳过此测试。
联网客户端在每次事务重试时按最新局面重新计算走法；这不等同于服务端防作弊。
数据库规则限制协商身份、服务端截止时间、本人认输及在线状态写入；规则不验证完整象棋走法，
仍不适合视作服务端权威的竞技对战系统。

## 悔棋、求和与认输

- 本地和联网均支持申请悔棋与求和。请求有效期 10 秒，拒绝、取消或超时不会改变局面。
- 悔棋由最后落子方申请，对方同意后仅撤回最后一手，包括恢复被吃棋子和原有将军状态。
- 等待请求时暂停落子；联网申请方可取消，对方可同意或拒绝。过期后自动解除等待。
- 认输先在操作方设备显示“再考虑一下 / 不考虑，认输”，确认过程不写入数据库；后者才同步终局。
- 本地由双方共用屏幕确认，认输默认当前行棋方，无法提供身份隔离或对同屏另一人隐藏弹窗。
- 联网房间号保存在当前标签页的 sessionStorage，刷新后恢复匿名身份及房间订阅；请求期限不会重置。
- 旧房间没有历史时不能悔棋，新落子开始保存历史。最多保留 80 手历史，重开或更换席位清空。

### 上线顺序与兼容性

1. 先在 Firebase 数据库模拟器运行测试，再发布 `database.rules.json`，最后发布新版前端。
2. 新规则要求事务携带操作类型和身份；旧版客户端的写入会被拒绝，参与者需刷新到新版。
3. `scripts/database-rules.mjs` 是规则生成源，输出应与已提交的 JSON 一致；一致性测试会检查漂移。
4. 新字段包括 `gameId`、`request`、`history`、`reason`、`resolution` 和 `operation`，旧房间无需批量迁移。
   历史快照保存为 JSON 字符串，避免数据库稀疏数组影响还原，并允许规则逐项限制历史修改。
5. 时间戳由 Firebase 生成，倒计时使用服务端时间偏移；服务端规则在截止时刻起拒绝接受请求。
   双方离线时不依赖后台定时任务删除请求，重连或下一次有效操作会清理过期请求。

本次新增逻辑与界面测试后共 131 项通过，生产构建通过。本地浏览器已验证同意/拒绝悔棋、
和棋、超时拒绝、取消认输及确认认输。模拟器测试已扩展到身份校验、接受/拒绝与超时拒绝，
但本环境缺少 Java 和 Firebase CLI，未实际运行；真实联网也未验收。

支持本地双人和跨手机、平板、电脑的中国象棋实时对战网站。创建者获得六码房间号并执红，第二位玩家输入房间号后执黑。

## 本地运行

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

未配置 Firebase 时，网站仍可体验本地双人模式。联网功能需要填写 `.env` 内的 Firebase Web App 配置。

## Firebase 免费配置

1. 在 [Firebase Console](https://console.firebase.google.com/) 创建项目并添加 Web 应用。
2. 在 **Authentication → Sign-in method** 启用 **Anonymous**。
3. 在 **Realtime Database** 创建数据库，复制 Web 配置到 `.env`；数据库 URL 填入 `VITE_FIREBASE_DATABASE_URL`。
4. 安装 Firebase CLI 后执行 `firebase login`、`firebase use <项目 ID>`、`firebase deploy --only database` 发布本仓库的安全规则。
5. 执行 `npm run build` 后用 `firebase deploy --only hosting` 发布网站。

Firebase Spark 免费方案适用于小规模房间对战。房间没有账号系统；同一浏览器的匿名身份用于刷新重连，离线席位会保留两分钟。

## 常用命令

```bash
npm run dev
npm run build
npm test
```
