# 开发约定 · CONTRIBUTING

面向本项目（美妆门店管理系统）的开发纪律。目的只有一个：**别让业务规则散落进 UI、别让同一件事写两遍。**

> 背景：本项目曾出现手工费公式在一个组件里重复 3 遍、套盒拆分在 4 个文件各写一遍、`handleConfirmPayment` 单函数 185 行的情况。下面的约定就是为了不再退化。

---

## 一、分层：每段代码先归位

```
src/
├── domain/     纯函数：算钱、判规则。无 db、无 React、无 import 组件
├── services/   编排：一次业务操作要写哪些表（含 db）
├── hooks/      数据获取与组件状态封装
├── lib/db/     数据访问薄层（fetchAll 分页等）
└── pages/ components/   只管 UI 和「调用上面三层」
```

**加新功能前，先问这段逻辑属于哪一层：**

| 这段代码在做… | 放哪 | 例子 |
|---|---|---|
| 算钱、判断规则、纯计算 | `domain/` | 手工费 `computeFee`、满减 `computePromoDiscount`、FIFO 扣次 |
| 一次操作写多张表 | `services/` | `salesService.checkout`、`refundService.refund` |
| 拉数据 / 组件内状态 | `hooks/` | `useMemberData` |
| 分页拉全量 | `lib/db` `fetchAll` | 不要手写 while 循环 |
| 展示、事件绑定 | `pages/` `components/` | 调用上面，不内联业务逻辑 |

**红线：组件的 onClick / handleXxx 里不允许出现手工费、满减、套盒拆分、抵扣顺序、库存扣减这类业务计算。** 它们必须在 `domain/` 或 `services/`。

---

## 二、同一件事只写一处

写第二次"套盒拆分""手工费""库存扣减"之前，**停下来搜一下是不是已经有了**：

```bash
grep -rn "kit_components\|computeFee\|deductFifo" src/domain src/services
```

有就复用，没有就抽成函数再用。**不要复制粘贴改一改**——这正是当初攒出 4 处套盒重复的原因。

---

## 三、业务规则必须有单元测试

- `domain/` 里每个函数都应有对应的 `*.test.js`（vitest）。规则函数是纯的，测试极便宜。
- **UI 不用测，规则必须测。**
- 改 `domain/` 函数前后各跑一次 `npm test`，红了就是改坏了既有行为。

```bash
npm test          # 跑一次
npm run test:watch  # 边改边看
```

参考样板：`src/domain/fee.test.js`、`src/domain/kit.test.js`。

---

## 四、组件别长回 1000 行

经验阈值：**单组件超过 ~400 行就该拆**。

- 数据获取 → 自定义 hook（样板 `hooks/useMemberData.js`）
- 自包含的 UI 块 → 子组件（样板 `ProjectCard.jsx` / `CheckoutRecordPanel.jsx` / `SalaryFormulaPanel.jsx`）
- 业务规则 → 已经在 `domain/` / `services/`，组件里不该再有

---

## 五、动钱的改动，build 绿不算完

CloudBase **没有事务**：销售/退款中途失败会留下半成品数据（流水已写、积分没扣）。这类改动：

1. `npm test` + `npm run build` 双绿是底线，但**不够**。
2. 必须在测试环境**真机跑一遍**核对各集合写入。例如完整销售：跑「会员 + 套盒 + 满减 + 积分抵扣 + 余额抵扣 + 赠品」，再退一件，核对
   `transactions / member_projects / points_records / balance_records / inventory / gift_records`
   与改动前一致。

---

## 六、提交前自查清单

- [ ] 业务计算在 `domain/`，多表写入在 `services/`，组件只调用
- [ ] 没有把已有逻辑复制粘贴第二遍
- [ ] 新增/改动的 `domain` 函数有单测，`npm test` 全绿
- [ ] `npm run build` 通过
- [ ] 改动文件没有新增 lint 报错（`npx eslint <file>`）
- [ ] 动钱路径（销售/退款/核销）已真机核对
- [ ] 改了规则/字段，同步更新 `CLAUDE.md`

---

## 七、命令速查

```bash
npm run dev    # 本地开发 → http://localhost:5174
npm test       # 单元测试（vitest run）
npm run build  # 构建
npm run lint   # 全量 lint（注意：历史遗留报错较多，关注自己改的文件即可）
```

---

> 一句话：**把会算钱、会决定写哪些表的逻辑，从按钮里拿出来，放进能单独测试的纯函数；同一件事只写一处。**
