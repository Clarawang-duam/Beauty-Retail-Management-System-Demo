# 美妆门店管理系统 · Demo

零配置本地演示版：数据存在浏览器 `localStorage`，**不连接腾讯云 CloudBase**。

正式生产仓：[Beauty-Retail-Management-System](https://github.com/Clarawang-duam/Beauty-Retail-Management-System)

## 在线演示

https://beauty-retail-demo.vercel.app

| 账号 | 密码 | 角色 |
|------|------|------|
| `demo` | `demo123` | 老板 |
| `staff1` | `123456` | 员工（小美） |
| `staff2` | `123456` | 员工（小林） |

演示预约号：`0001`（手工核销可搜）

> 国内访问可能偏慢或不稳定；能翻墙时更稳妥。

## 本地启动

```bash
npm install
npm run dev
# → http://localhost:5174
```

登录页 / 设置页可「重置演示数据」。

## 与生产仓的差异

- 始终演示模式（内存假库 + 种子数据）
- 无 `@cloudbase/js-sdk` 依赖
- 打卡使用假定位与可选演示照片
- 种子含近两周销售/手工费、本月考勤，方便看老板/员工看板

## 技术栈

React 19 + Vite + Tailwind CSS v3 · Zustand · React Router HashRouter · Recharts · xlsx · @zxing/browser
