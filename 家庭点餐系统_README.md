# 家庭点餐系统

一个面向家庭内部使用的轻量级点餐与菜品管理系统。

项目以**手机移动端使用为主**，同时兼顾平板和 PC 浏览器访问。系统以低成本、易维护、易扩展为核心目标，初期不开发原生 App，采用 Web + PWA 方案。

---

## 1. 项目目标

解决家庭日常点餐中的几个问题：

- 每天不知道吃什么
- 家庭成员点餐意见不统一
- 菜品越来越多，不方便查找
- 经常重复吃相同的菜
- 想吃某种食材或某种做法时不好筛选
- 希望能够随机决定今天吃什么
- 希望记录家庭长期的饮食习惯

系统最终形成：

> **菜品管理 → 浏览筛选 → 收藏/常吃 → 家庭点餐 → 随机点餐 → 点餐记录 → 根据历史数据优化随机结果**

---

# 2. 产品定位

## 2.1 使用范围

系统主要用于：

> 家庭内部使用

不以商业餐厅点餐为目标，因此不需要：

- 商家入驻
- 商品支付
- 外卖配送
- 复杂会员体系
- 短信验证码
- 商业订单系统
- 复杂营销系统

## 2.2 使用设备

主要支持：

1. 手机
2. 平板
3. PC 浏览器

优先保证手机端体验。

---

# 3. 技术路线

## 3.1 第一阶段

采用：

```text
Vue 3
+
Vite
+
PWA
+
Supabase（免费层）
+
GitHub Actions（keep-alive，见第 37 节）
```

### 3.1.1 已确认的后端方案：B′

对比过 A（微信小程序云开发）、B（Cloudflare Pages + Workers + D1 + R2）、
C（本地优先 + 轻同步）之后，选定 **B′ = Supabase 免费层 + GitHub Actions 保活**。

选它的理由：零月费、不会因不活跃被删数据（配了保活之后）、Vue 技术栈不用换、
数据完全在自己手里。代价是 `*.supabase.co` 与 `*.github.io` 在国内均为间歇可达，
**这个风险由 PWA 离线优先来兜**（见第 37.4 节），而不是由钱来解决。

被否掉的两个方案，记录一下原因免得以后重新讨论一遍：

| 方案 | 年成本 | 否掉的原因 |
|---|---|---|
| A 微信小程序云开发 | ≈ 239 元 | 云开发自 2025-02-19 起，未发布小程序只给 6 个月免费环境，发布后 19.9 元/月。要换 uni-app，且主包 2MB 装不下水彩插画 |
| B Cloudflare 全家桶 | 0 元（域名另计） | 免费额度对这张表绰绰有余（Workers 10 万请求/天、D1 5GB、R2 10GB 且出口免费），但要自己写 API 层，且 `pages.dev` 国内可达性不比 Supabase 好 |

### 3.1.2 身份与隔离模型

第一阶段仍然不做账号体系（见第 21 节），但落到 Supabase 上必须是这个形状：

```text
每台设备匿名登录（Anonymous sign-in）
        │
        └──> 得到一个 auth.uid()
                │
                └──> 用邀请码调 join_family(code, '爸爸')
                        │
                        └──> 该 uid 被登记成 family_members 的一行
```

爸爸 / 妈妈 / 孩子各用一台设备，天然就是三个成员，不需要注册。
代价是**换设备或清浏览器数据后要重新用邀请码进一次**，家庭场景可接受。

关键约束：**所有数据隔离必须由 RLS 在数据库层强制**，不允许只在前端判断。
anon key 是设计上就会暴露在前端的，没有 RLS 就等于任何拿到 URL 的人都能读写你家的库。
`service_role` key 与 Supabase 个人访问令牌**只能放 CI Secrets，绝不能进仓库**。


整体架构：

```text
                 家庭点餐系统
                       │
                 Vue 3 前端
                       │
          ┌────────────┼────────────┐
          │            │            │
        手机          平板          PC
        PWA           PWA          Web
                       │
                       ↓
                   Supabase
                       │
              ┌────────┴────────┐
              │                 │
            数据库            文件存储
```

## 3.2 为什么采用 Vue

Vue 3 主要负责：

- 页面开发
- 组件开发
- 状态管理
- 数据交互
- 响应式布局

Vue 本身不会限制未来的多端扩展。

未来如果需要开发 Android / iOS，可以通过：

```text
Vue 3
   ↓
Capacitor
   ↓
Android / iOS
```

继续复用大量业务代码。

因此当前阶段不为了“未来可能的原生 App”增加不必要的开发成本。

---

# 4. 多端设计原则

前端从第一天开始采用响应式设计。

不要针对某一个设备单独开发业务逻辑。

采用：

```text
业务逻辑
    ↓
Vue 组件
    ↓
响应式布局
    ↓
手机 / 平板 / PC
```

数据和业务逻辑保持一致，仅调整 UI 布局。

---

# 5. 产品功能结构

## 5.1 首页

```text
首页
│
├── 我要点餐
│
├── 🎲 随机吃什么
│
├── 今日点餐
│
├── 我的常吃
│
├── 我的收藏
│
└── 菜品管理
```

---

# 6. 我要点餐

进入“我要点餐”后：

```text
我要点餐
│
├── 早餐
│
└── 正餐
    │
    ├── 荤菜
    ├── 素菜
    ├── 火锅
    ├── 汤
    ├── 主食
    └── 其他
```

---

# 7. 早餐

早餐采用独立分类。

```text
早餐
│
├── 主食
├── 面食
├── 粥
├── 蛋类
├── 饮品
└── 其他
```

早餐不强制按照“荤菜/素菜”进行分类。

---

# 8. 正餐

正餐分为：

```text
正餐
│
├── 荤菜
├── 素菜
├── 火锅
├── 汤
├── 主食
└── 其他
```

> 修订说明：原设计只有「荤菜 / 素菜 / 火锅 / 其他」四类，但第 12.2、12.3 节的
> 随机配菜与随机一桌都要按「荤 + 素 + 汤 + 主食」组桌，汤和主食塞进「其他」会让
> 一桌规则没法表达。所以把这两类提为一级分类，「其他」留给凉菜、卤味这类。
> 分类清单存在 `category_dict` 表里，前端读表渲染，不写死。


---

# 9. 荤菜筛选

荤菜采用：

> **食材 + 做法**

二维筛选模式。

移动端采用：

```text
左侧：食材
顶部：做法
中间：菜品
```

例如选择：

```text
鸡肉 + 炒
```

得到：

```text
宫保鸡丁
辣子鸡
青椒炒鸡
小炒鸡
```

---

# 10. 素菜

素菜可以根据实际需要继续细分。

例如：

```text
蔬菜
菌菇
豆制品
蛋类
其他
```

注意：

> 菜品分类与具体食材类型不是同一个概念。

例如“西红柿炒鸡蛋”可以归入“正餐 → 素菜”，但其主要食材仍然可以记录为“鸡蛋”。

数据库中的“分类”和“食材”需要独立。

---

# 11. 火锅

火锅采用独立分类体系。

```text
火锅
│
├── 锅底
├── 肉类
├── 海鲜
├── 蔬菜
├── 丸类
├── 豆制品
├── 菌菇
└── 其他
```

未来支持：

> 🎲 随机火锅

自动组合：

```text
锅底
+
肉类 × 2
+
蔬菜 × 2
+
丸类 × 1
+
豆制品 × 1
```

---

# 12. 随机点餐

随机点餐是系统核心功能之一。

入口：

```text
🎲 随机吃什么
```

## 12.1 随机一道

从符合条件的菜品中随机选择一道。

可以设置：

- 早餐 / 正餐
- 荤菜 / 素菜 / 火锅 / 汤 / 主食 / 其他
- 食材
- 做法
- 口味

## 12.2 随机配菜

根据家庭用餐场景自动组合。

例如：

```text
晚餐

荤菜：红烧排骨
素菜：清炒小白菜
汤：紫菜蛋花汤
主食：米饭
```

## 12.3 随机一桌菜

根据家庭人数和菜品类型生成完整菜单。

例如：

```text
2～3人：

荤菜 × 1
素菜 × 1
汤 × 1
主食 × 1
```

具体规则后续根据家庭实际情况配置。

---

# 13. 随机算法

随机不能简单使用：

```javascript
Math.random()
```

需要考虑历史数据。

主要因素：

```text
最近吃过时间
+
历史吃过次数
+
家庭成员偏好
+
收藏状态
+
菜品类别
```

最终实现：

> **不是完全随机，而是“有记忆的随机”。**

最近吃过、高频菜降低权重；很久没吃、历史吃得少的菜提高权重；家庭成员喜欢的菜提高权重。

---

# 14. 菜品数据库设计

核心原则：

> **菜品不采用固定文件夹层级存储，而采用属性和标签进行描述。**

一个菜品由：

```text
基础信息
+
分类
+
食材
+
做法
+
标签
+
口味
+
制作信息
+
历史数据
```

组成。

---

# 15. dishes 菜品表

已按 `supabase/migrations/0001_init.sql` 实现，字段以该文件为准：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键，`gen_random_uuid()` |
| family_id | UUID | **新增**，RLS 隔离键，所有表都带这一列或由父表推导 |
| name | TEXT | 菜品名称，`(family_id, meal_type, category, name)` 唯一 |
| meal_type | TEXT | 早餐 / 正餐，CHECK 约束 |
| category | TEXT | 见第 8 节 |
| subcategory | TEXT | **新增**，默认空串；只有「火锅」用到（锅底/肉类/海鲜/…） |
| ingredient_id | INT | 主食材 → ingredients.id |
| cooking_method_id | INT | 主要做法 → cooking_methods.id |
| description | TEXT | 菜品描述 |
| image_path | TEXT | **改名**：存 Storage 对象路径（`{family_id}/xxx.webp`），公开 URL 由前端拼，避免换项目时整表改 URL |
| spicy_level | INT | 辣度 0–5，CHECK |
| difficulty | INT | 制作难度 1–5，CHECK |
| cooking_time | INT | 制作分钟数 1–600，CHECK |
| is_favorite | BOOLEAN | 是否收藏 |
| is_active | BOOLEAN | 是否启用（删除走停用，见第 37.3 节） |
| eat_count | INT | 吃过次数，由 `confirm_order()` 维护 |
| last_eaten_at | TIMESTAMPTZ | 最近吃的时间，NULL = 从来没点过 |
| created_at / updated_at | TIMESTAMPTZ | `updated_at` 由触发器维护 |

三个部分索引都带 `where is_active`，因为点餐列表永远只查启用菜，管理页才需要看全量。


---

# 16. ingredients 食材表

食材独立管理。

示例：

| ID | 名称 | 类型 |
|---:|---|---|
| 1 | 猪肉 | 肉类 |
| 2 | 牛肉 | 肉类 |
| 3 | 鸡肉 | 肉类 |
| 4 | 羊肉 | 肉类 |
| 5 | 鸭肉 | 肉类 |
| 6 | 鱼 | 水产 |
| 7 | 虾 | 水产 |
| 8 | 螃蟹 | 水产 |
| 9 | 鸡蛋 | 蛋类 |
| 10 | 豆腐 | 豆制品 |

---

# 17. cooking_methods 做法表

示例：

| ID | 做法 |
|---:|---|
| 1 | 炒 |
| 2 | 炖 |
| 3 | 蒸 |
| 4 | 煮 |
| 5 | 炸 |
| 6 | 煎 |
| 7 | 烤 |
| 8 | 焖 |
| 9 | 卤 |
| 10 | 红烧 |
| 11 | 糖醋 |
| 12 | 凉拌 |

---

# 18. tags 标签表

标签用于描述菜品的附加属性。

示例：

```text
口味
├── 辣
├── 不辣
├── 清淡
└── 酸甜

特点
├── 下饭
├── 家常
└── 快手菜

人群
├── 适合儿童
└── 适合老人

季节
├── 夏季
└── 冬季
```

---

# 19. dish_tags 菜品标签关联表

一个菜品可以拥有多个标签。

例如：

```text
宫保鸡丁
│
├── 辣
├── 下饭
└── 家常
```

采用多对多关系：

```text
dishes
   │
   └── dish_tags
           │
           └── tags
```

---

# 20. 家庭成员

为了支持多端使用，需要建立家庭概念。

一个家庭可以拥有多个成员：

```text
family
   │
   ├── 爸爸
   ├── 妈妈
   └── 孩子
```

---

# 21. family_members 家庭成员表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 成员ID |
| family_id | UUID | 家庭ID |
| auth_uid | UUID | **新增**，`unique references auth.users(id)`，即这台设备的匿名登录身份 |
| name | TEXT | 成员显示名 |
| avatar | TEXT | 头像 |
| role | TEXT | owner / member，只有 owner 能改家庭信息 |
| created_at | TIMESTAMPTZ | 创建时间 |

第一阶段不需要复杂账号体系，采用：

> 家庭邀请码（6 位，`families.invite_code` 自动生成）/ 家庭链接

进入家庭。实现上是两个 `SECURITY DEFINER` RPC：

```text
create_family(家庭名, 我的名字)  -> {family_id, member_id, invite_code}
join_family(邀请码, 我的名字)     -> member_id
```

不开 `family_members` 的直接 INSERT 权限，防止任何人自称是别人家的成员。

已知代价：匿名 uid 存在浏览器里，**换设备或清数据 = 新成员**，需要重新走一次邀请码。
后续要修，就在 `join_family` 里加一个「认领已有成员」的确认步骤，不必推倒重来。


---

# 22. 家庭成员菜品偏好

建立：

```text
member_dish_preferences
```

记录：

```text
成员
+
菜品
+
偏好
```

例如：

```text
爸爸 → 香辣虾 → 喜欢
妈妈 → 香辣虾 → 一般
孩子 → 香辣虾 → 不喜欢
```

用于后续：

> 全家随机点餐

---

# 23. 点餐记录

点餐记录采用：

```text
meal_orders
```

保存一次家庭用餐。

例如：

```text
2026-10-02
晚餐
```

对应多个菜品：

```text
红烧排骨
西红柿炒鸡蛋
清炒小白菜
紫菜蛋花汤
米饭
```

---

# 24. meal_orders

建议字段：

| 字段 | 说明 |
|---|---|
| id | 点餐记录ID |
| family_id | 家庭ID |
| meal_date | 用餐日期 |
| meal_type | 早餐/午餐/晚餐/其他 |
| status | 草稿/已确认/已完成 |
| created_by | 创建人 |
| created_at | 创建时间 |

---

# 25. meal_order_items

一条点餐记录对应多个菜品。

| 字段 | 说明 |
|---|---|
| id | 明细ID |
| order_id | 点餐记录ID |
| dish_id | 菜品ID |
| quantity | 数量 |
| category | 菜品类型 |
| created_at | 创建时间 |

完成一次点餐后更新菜品统计：

```text
dishes.eat_count += 1
dishes.last_eaten_at = 当前时间
```

---

# 26. 数据库整体关系

```text
family
│
└── family_members
      │
      └── member_dish_preferences


dishes
│
├── ingredients
│
├── cooking_methods
│
├── dish_tags
│      │
│      └── tags
│
└── 菜品历史统计


meal_orders
│
└── meal_order_items
       │
       └── dishes
```

---

# 27. 菜品数据示例

```json
{
  "name": "宫保鸡丁",
  "meal_type": "正餐",
  "category": "荤菜",
  "ingredient": "鸡肉",
  "cooking_method": "炒",
  "spicy_level": 2,
  "difficulty": 2,
  "cooking_time": 20,
  "tags": [
    "辣",
    "下饭",
    "家常"
  ]
}
```

---

# 28. 菜品属性设计原则

## 原则一：分类与食材分离

不要让“鸡肉类”同时承担：

```text
分类
+
食材
```

而应该：

```text
category = 荤菜
ingredient = 鸡肉
```

## 原则二：做法独立

使用：

```text
cooking_method = 红烧
```

而不是在程序中根据菜名判断。

## 原则三：标签可扩展

未来出现：

```text
空气炸锅
低脂
高蛋白
下饭
快手
儿童友好
```

直接增加标签即可。

## 原则四：历史数据独立于菜品属性

“这个菜吃过几次”和“这个菜是什么菜”是两个不同概念。

---

# 29. 项目第一阶段功能范围

```text
① 家庭创建 / 加入

② 菜品管理
   ├── 新增
   ├── 编辑
   ├── 删除/停用
   ├── 收藏
   └── 图片

③ 菜品浏览
   ├── 早餐
   ├── 荤菜
   ├── 素菜
   ├── 火锅
   ├── 汤
   ├── 主食
   └── 其他

④ 菜品筛选
   ├── 食材
   ├── 做法
   ├── 标签
   └── 搜索

⑤ 今日点餐

⑥ 随机点餐
   ├── 随机一道
   ├── 随机配菜
   └── 随机一桌

⑦ 点餐历史

⑧ 收藏 / 常吃
```

---

# 30. 后续功能

第二阶段可以增加：

```text
家庭成员偏好
智能随机
菜品推荐
购物清单
食材库存
营养信息
菜谱步骤
烹饪视频
```

进一步形成：

> **点餐 → 菜谱 → 食材 → 采购清单**

---

# 31. 低成本原则

第一阶段全部走免费服务，实际额度与用量对照如下：

| 服务 | 免费额度 | 本项目预估用量 | 结论 |
|---|---|---|---|
| Vue 3 / Vite / PWA | 开源免费 | — | 0 元 |
| GitHub（代码 + Actions） | 私有库 2000 分钟/月；公开库免费 | 保活任务约 30 分钟/月 | 0 元 |
| Supabase 数据库 | 500 MB | 30 道菜 + 3 年记录 ≈ 几十 MB | 用不到 5% |
| Supabase Storage | 1 GB | 现有插画 4.2 MB | 够，但见 37.3 |
| Supabase 出口流量 | 5 GB / 月 | 约 0.2 GB / 月 | 够 |
| 前端托管 | GitHub Pages | — | 0 元，但有可达性风险，见 37.4 |

初期明确不买：

```text
域名        服务器        短信服务
第三方支付  App Store     商业推送
```

## 31.1 免费不等于无风险，两条必须记住

**一、Supabase 免费项目连续 1 周无活动会被暂停，且不会自动恢复。**
必须在 Dashboard 手动 restore 或调 Management API；暂停超过 90 天数据直接清除。
家庭点餐恰好是低频应用（出门旅游两周就中招），所以保活工作流不是优化项，
是**防止全家数据消失的保险丝**。详见第 37 节。

**二、可达性实测结论（2026-10-03，强制 `--noproxy` 直连，每项 3 次）**

开发机开着 Windows 系统代理（`127.0.0.1:7897`），**会污染一切可达性测试**——
不加 `--noproxy '*'` 得到的"能访问"是假的。强制直连后的真实结果：

| 域名 | 结果 | 含义 |
|---|---|---|
| `oqdbpo.github.io` | **200 ×3** | ✅ 前端已上线，家人手机能打开 |
| `fonts.googleapis.com` / `gstatic` | 200 / 404 | ✅ 手写体能加载，设计语言不受影响 |
| `pages.dev` | 301 ×3 | ✅ 备选前端托管可用 |
| `*.workers.dev` | 超时 ×3 | ❌ 反代必须挂自定义域名，不能用免费子域 |
| `*.supabase.co` | **RESET ×21** | ❌ 唯一被硬挡的一环 |

所以问题被收窄成一件事：**不是 GitHub Pages 不行，也不是 Supabase 这个数据库不行，
而是 `*.supabase.co` 这一个通配域名被 SNI 过滤。** 换任何境外数据库都一样被挡，
境内方案则要服务器 + 备案。出路只有"域名 + Worker 反代"这一条，约 65 元/年。

**当前实际状态**：前端已可分享（`https://oqdbpo.github.io/family-menu/`），
但家人打开后会停在「正在叫醒厨房」态——页面能加载，数据不能。
在反代落地之前，这个链接只有开着代理的人能用。

如果实际使用人数和数据量以后明显增加，再根据实际情况升级。


---

# 32. 前端目录规划

仓库根目录（已建好的部分）：

```text
家庭菜单/
│
├── 家庭点餐系统_README.md
│
├── design/                      设计稿，实现时的唯一视觉基准
│   ├── preview.html             设计令牌 + 组件规范 + 核心 6 页原型
│   ├── assets/                  14 张已归一化到 #F4F1E9 的水彩插画
│   └── _raw/                    1024px 未处理原件，改尺寸时从这里重跑
│
├── supabase/
│   ├── migrations/0001_init.sql 建表 + RLS + RPC + 随机算法
│   └── seed.sql                  字典 + 30 道菜 + 两周历史
│
└── .github/workflows/
    └── keepalive.yml             Supabase 保活（见第 37 节）
```

前端源码：

```text
src/
│
├── assets/
│   └── styles/tokens.css        设计令牌，禁止在组件里写十六进制
│
├── components/
│   ├── DishCard.vue             对应设计稿 .dish
│   ├── DishFilter.vue           对应 .chip / .chips / .side（食材×做法二维）
│   ├── DishList.vue
│   ├── RandomDish.vue           对应 .dice-btn / .result / .why
│   ├── MealCard.vue             对应 .grp + 步进器行
│   └── base/
│       ├── Seg.vue  TabBar.vue  Dock.vue  Sheet.vue
│       └── State.vue            空态 / 骨架 / 离线 / 提示条 / 休眠唤醒中
│
├── views/
│   ├── Home.vue
│   ├── Order.vue
│   ├── Breakfast.vue
│   ├── Dinner.vue
│   ├── Hotpot.vue
│   ├── Random.vue
│   ├── TodayOrder.vue
│   ├── Favorites.vue
│   └── DishManage.vue
│
├── stores/
│   ├── family.js
│   ├── dishes.js
│   └── orders.js
│
├── services/
│   ├── supabase.js
│   ├── dishes.js
│   └── orders.js
│
├── router/
│
├── utils/
│   └── image.js                 上传前压缩到 <=200KB（见 37.3）
│
└── App.vue
```


---

# 33. 开发原则

## 33.1 移动端优先

首先保证手机：

- 单手操作
- 大按钮
- 清晰层级
- 快速筛选
- 少输入
- 少页面跳转

## 33.2 数据驱动 UI

分类、食材、做法、标签尽量来自数据库，不大量写死在前端代码中。

## 33.3 业务逻辑与 UI 分离

随机点餐算法等核心业务规则放在独立的 services / utils 中，而不是直接写在页面组件中。

未来 Web、Android、iOS 使用同样的业务规则。

---

# 34. 长期架构目标

```text
                    家庭点餐系统
                           │
                 ┌─────────┴─────────┐
                 │                   │
             前端应用              数据服务
                 │                   │
          ┌──────┼──────┐        Supabase
          │      │      │
        手机    平板     PC
          │      │      │
        PWA     PWA     Web
          │
       Capacitor
       ┌───┴───┐
    Android   iOS
```

核心原则：

> **前端可以变化，数据库和业务规则尽量保持稳定。**

---

# 35. 当前确定的核心产品逻辑

```text
                家庭点餐
                    │
        ┌───────────┴───────────┐
        │                       │
      手动点餐                随机点餐
        │                       │
  ┌─────┼─────┐          ┌──────┼──────┐
 早餐  正餐  搜索        随机一道  随机配菜  随机一桌
        │
 ┌──────┼────────┐
 荤菜   素菜     火锅
   │
食材 + 做法
   │
   ↓
菜品
   │
   ├── 收藏
   ├── 常吃
   ├── 历史
   └── 家庭偏好
             │
             ↓
       智能随机推荐
```

---

# 36. 下一步开发顺序

```text
第一步
项目初始化
Vue 3 + Vite + PWA

↓

第二步
Supabase 数据库

↓

第三步
建立菜品基础数据

↓

第四步
菜品管理页面

↓

第五步
菜品浏览 + 分类筛选

↓

第六步
今日点餐

↓

第七步
随机点餐

↓

第八步
点餐历史 + 菜品统计

↓

第九步
家庭成员与偏好

↓

第十步
优化随机算法

↓

第十一步
PWA 手机体验优化

↓

第十二步
根据实际需求扩展 Android / iOS
```

---

# 37. 部署与运维

## 37.1 首次部署（已实测跑通，2026-10-02）

```text
① Supabase 建项目                    区域 ap-northeast-1 (Tokyo)，记下 project ref
② 开启匿名登录
     UI 路径：Authentication → Sign In / Up → 往下滚找 Anonymous 卡片
     （旧文档写的 "Authentication → Providers" 已不是菜单文字，容易找不到）
     或绕开 UI：node supabase/set-anonymous.mjs
       真实字段名是 external_anonymous_users_enabled（不是文档暗示的 disable_anonymous_sign_ins）
③ node supabase/run-sql.mjs supabase/migrations/0001_init.sql
④ node supabase/run-sql.mjs supabase/migrations/0002_family_id_default.sql
⑤ node supabase/run-sql.mjs supabase/seed.sql
⑥ 通知 PostgREST 重载 schema 缓存：
     notify pgrst, 'reload schema';
     ↑ 不做这步，/rest/v1/rpc/* 会返回 404 "requested path is invalid"
⑦ node supabase/verify.mjs --write     10 项全绿才算通
⑧ 建 GitHub 仓库并推送，配 4 项 Actions Secrets/Variables，手动 Run 一次 workflow
```

第 ⑤ 步建的示范家庭邀请码固定是 `DEMO01`，验证完可以删掉另建自己的家。

> 在 Dashboard 的 SQL 编辑器里直接 `select * from dishes` 是**能看到全部行的**，
> 因为编辑器以属主身份运行、绕过 RLS。要验证 RLS 必须用 anon key 通过 PostgREST
> 发请求——`verify.mjs` 第 2 项干的就是这件事：未加入家庭时必须读到 0 行。

## 37.1.1 实测踩到的三个坑（都已修，记录原因）

| 现象 | 根因 | 修法 |
|---|---|---|
| 迁移报 `loop variable of loop over rows must be a record variable` | `random_table` 内层 `for r in` 的 `r` 没声明 | 0001 里补 `r record` |
| `/rest/v1/rpc/join_family` 返回 404 | PostgREST schema 缓存未刷新；另外 RPC 路径必须带 `/rest/v1` 前缀 | `notify pgrst,'reload schema'` |
| 插 meal_orders 报 403 RLS | `family_id` 要客户端显式传，漏传即违反 with check；且让客户端提供租户 ID 本身是反模式 | 0002 改成列默认值 `current_family_id()`，客户端不碰这列 |

## 37.1.2 网络可达性：实测结论（重要）

在开发机上直接测同一时刻的 TLS 握手：

```text
supabase.com                          200   ✓
api.supabase.com                      可达  ✓
www.cloudflare.com                    200   ✓
<ref>.supabase.co                     TLS connection reset  ✗
```

Cloudflare 本身通、Supabase 主站通、Management API 通，**只有 `*.supabase.co`
被硬 reset** —— 这是针对该通配域名的 **SNI 级过滤**，不是 Cloudflare 的问题，也不是慢。

影响范围：PostgREST、Auth、Storage 三条路全在 `*.supabase.co` 下，**全部不可直连**。
开发机上靠本地代理绕过（`supabase/.env.local` 里配 `HTTPS_PROXY`，`verify.mjs`
会自动带 `NODE_USE_ENV_PROXY` 重启自己），但**家人手机上没有这个代理**。

也就是说：**不做任何处理，B′ 对家人是不可用的**，不是体验差，是连不上。三条出路：

| 出路 | 年成本 | 说明 |
|---|---|---|
| 域名 + Cloudflare Worker 反代 | ≈ 60–70 元 | Worker 转发 `/rest/*`、`/auth/*`、`/storage/*` 到项目域名。客户端 SNI 变成你自己的域名，绕开通配过滤；Worker→Supabase 那一跳在境外不受影响。注意 `*.workers.dev` 本身也被墙，**必须挂自定义域名** |
| Supabase 官方 Custom Domain | 25 美元/月 | 直接给项目域名，但免费层没有这个功能 |
| 回到方案 A（微信小程序云开发） | ≈ 239 元 | 完全没有这个问题，家人在群里点卡片就进来了 |

这个实测结果是把 B′ 从"赌网络"改成"有证据表明需要额外一层"的关键，选型时按它来。


## 37.2 保活工作流

`.github/workflows/keepalive.yml` 每 6 小时跑一次，做三件事：

```text
1) 用 anon key 打一次真实 PostgREST 查询
      ↑ 必须真查表。只 ping 前端静态页不产生数据库连接，等于没保活
2) 查不到 → 读 Management API 的项目状态
      PAUSED    → 自动 POST /restore
      其它      → 抛错要求人工排查
3) 距上次超过 20 天 → 自动提交一次心跳
      ↑ 防的是 GitHub 那个坑：私有仓库连续 60 天无提交会静默停用
        scheduled workflow，而定时任务自己的运行不算「仓库活动」。
        家庭项目两个月没人 commit 太正常了，不处理就是保险丝自己烧了。
```

任何一步失败都会让 workflow 标红。**务必在 GitHub 个人设置里打开 workflow failure
邮件通知**，否则这套告警等于零——你不会主动去看 Actions。

## 37.3 图片规则

```text
桶        dish-images（公开读）
路径      {family_id}/{dish_id}.webp        ← RLS 按第一层目录隔离
命名      前端存 image_path，不存完整 URL
尺寸      等比缩到最长边 800px → WebP q72 → <= 200KB
```

必须在前端压缩再上传（`utils/image.js`，Canvas 缩放即可，不用引库）。
免费层只有 1GB 存储 + 5GB 月出口，手机原图 3–5MB 一张，传 300 张就爆了。

**删除一律走 `is_active = false`，不做物理删除。**
`meal_order_items.dish_id` 是 `on delete restrict`，真删有历史的菜会被数据库拒绝——
这是故意的，家庭菜单的历史记录比菜名值钱。

## 37.4 PWA 离线优先

这是「国内间歇不可达」的唯一有效缓解，不是可选项：

```text
Service Worker 缓存
  预缓存    App shell + tokens.css + 14 张插画
  运行时    /rest/v1/dishes 等读请求 → stale-while-revalidate
  写请求    进 IndexedDB 的 outbox 队列，联网后重放

UI 必须有的三个态
  离线      「离线中 · 显示上次缓存的 N 道菜」
  唤醒中    项目刚 restore，API 会超时 30–90s → 「正在叫醒厨房」+ 自动重试
  失败      「保存失败，草稿已留在本机，可重试」← 必须给出「数据没丢」的确定感
```

家人首次访问后引导「添加到主屏幕」，之后日常浏览、点餐、随机全部本地命中，
只有确认点餐才需要出网。域名被污染时，影响从「全家打不开」降级为「稍后再同步」。

## 37.5 随机算法的落点

第 33.3 节要求业务逻辑不进组件，具体是这样分的：

```text
utils/random.js 不存在 —— 算法整个在数据库里
        │
supabase rpc random_dish(meal_type, category, ingredient, method, tag, exclude, limit)
supabase rpc random_table(people, meal_type)
        │
        └─> 返回 {dish_id, score, days_since, eat_count, reasons[]}
                                          │
                                          └─> 设计稿 .result .why 那六条权重条
```

`reasons[]` 里每项是 `{key, label, detail, weight}`，前端只负责画，
**不参与任何计算**。这样 Web / Android / iOS 三端拿到的是同一个分数和同一套解释。

一桌菜的抽样用 Gumbel top-k（`-ln(U)/w` 升序取前 N），等价于按权重不放回抽样，
所以不会出现同一道菜占两个槽位。

## 37.6 当前状态

| 产物 | 状态 |
|---|---|
| `design/preview.html` | 浏览器实测：51 处图片全加载、零横向溢出 |
| `design/assets/` 14 张 | 已归一化 + 去水印 + 压缩；原件在 `design/_raw/` |
| `supabase/migrations/0001_init.sql` | **已在真实 Supabase 执行通过**（Tokyo 区） |
| `supabase/migrations/0002_family_id_default.sql` | 已执行 |
| `supabase/seed.sql` | 已执行，30 道菜 + 11 条历史订单 |
| Storage `dish-images` | 11 张菜品插画已上传并回填 `image_path`，剩 19 道待家人实拍 |
| `supabase/verify.mjs` | 10 项全绿（含 RLS 隔离、随机权重、confirm 幂等） |
| `.github/workflows/keepalive.yml` | **已上线并跑通**：首次手动运行 `conclusion=success`，PostgREST 返回 200，心跳提交已由 `keepalive-bot` 推回仓库 |
| GitHub 仓库 | `oqdbpo/family-menu`，**public**（Pages 免费档不支持私有库），main 分支 |
| GitHub Pages | **已上线** `https://oqdbpo.github.io/family-menu/`；`deploy-web` run #1 success；强制直连实测首页 / manifest / sw.js / 图标 / JS 主包全部 200 |
| 部署方式 | push 到 main 自动触发 `.github/workflows/deploy.yml`；后端地址在构建时从 Actions Variables/Secrets 注入，不进仓库 |
| PWA 图标 | `public/icons/` 四件套（192 / 512 / apple-touch / maskable），由 `tools/img.mjs --crop` 从主视觉裁出。此前 manifest 引用了不存在的文件，PWA 装上去会没图标 |
| Actions Secrets & Variables | `SB_ANON_KEY` `SB_MGMT_TOKEN`（Secrets）+ `SB_URL` `SB_PROJECT_REF`（Variables）全部写入 |
| `design/_raw/` | **不进仓库**（17 MB 未处理原件，本地保留；`design/assets/` 才是产物） |
| `src/` Vue 3 前端 | 6 个页面 + 加入家庭页，已连真实数据跑通；**未做视觉截图核对** |

## 37.6.1 仓库与凭据的当前约定

```text
身份      git user.name=che / email=404909615@qq.com，只写在仓库 local config，
          没有动全局配置
密钥      全部集中在 supabase/.env.local（已被 .gitignore 的 *.local 规则排除）。
          提交前用 git diff --cached --name-only 复核过，暂存区里唯一的 .env* 是
          .env.example，内容全是占位符
一次性    建仓用的 GitHub PAT 用完即从 .env.local 清空，CI 不依赖它
          （workflow 用的是 runner 自带的 GITHUB_TOKEN）。
          ⚠ 该 PAT 曾在对话里出现过，建议直接去 GitHub 吊销重建
网络      这台机器上 api.github.com 直连通，github.com 直连超时，
          所以 tools/github-setup.mjs 里是「API 直连 + git 走 127.0.0.1:7897 代理」。
          凭据只通过临时 askpass 注入，跑完即删，不写进 .git/config
```

**GitHub Secrets 加密的两个坑**，改脚本时别踩回去：

1. `tweetnacl` **没有实现 sealed box**（只有 SHA-512，而 GitHub 用 libsodium 的 blake2b 派生 nonce），必须用 `libsodium-wrappers`。
2. `libsodium.to_base64()` **默认是 URLSAFE 变体**（含 `_` `-`），GitHub 要标准 base64。用错会得到"API 返回成功、workflow 里解不开"的 Secret。脚本里统一走 `Buffer.from(x).toString('base64')` 规避。


## 37.7 前端实现要点

```text
路由      hash 模式。GitHub Pages 没有 SPA rewrite，history 模式刷新子路由会 404
鉴权      启动即 signInAnonymously；未加入家庭一律重定向到 #/join
          supabase-js 必须设 detectSessionInUrl:false，否则它会吃掉 #/order 这种 hash
配置      VITE_SB_URL 是唯一出口地址。上反代时只改 .env，代码零改动
          本地生成：node tools/gen-env.mjs（读 supabase/.env.local）
令牌      匿名 uid 存在浏览器里，换设备/清数据 = 新成员，需重新走邀请码
```

**建单时机**是个踩过的坑：最初 `ensureDraft()` 挂在页面 `load()` 上，结果只是浏览一下
今日点餐就会在库里攒出空草稿（实测一次测试会话留下 17 条）。现在改成
**第一次加菜才建单**，`order.value.id` 为 null 表示"还没落库的虚拟草稿"；
把最后一道菜移除时也会顺手删掉这条空草稿。

**已确认的餐是历史，锁死不可改。** 确认之后 `eat_count` 已经回写，再往里加菜会让
计数和点餐记录对不上（实测发生过：一笔已确认的晚餐被追加到 9 道菜）。
所以 `setQty()` 里有一道锁，且**必须放在 `ensureOrder()` 之后判断**——
页面刚进来时 `order.value` 还是 null，提前判断会让第一次点击绕过锁定，这个坑实测踩过两次。
UI 上的表现：已确认的订单不再显示步进器和删除按钮，改成只读的 `× N` 徽章，
并给一条 info 横幅说明"换个餐次或日期就能继续点"。

**删除已选菜品**有三个入口，都是即时的：菜品卡上的 `×` 小圆钮、把步进器按到 0、
以及今日点餐页底部的「清空这顿」（两段式确认，点一次变红提示、四秒内再点一次才真清）。

**supabase-js 的 `delete()` 必须链式写**：`sb.from(t).delete().eq('id', x)`。
写成 `.delete({ id: x })` 在 2.117 上**不会生成 WHERE 子句**，直接报
`DELETE requires a WHERE clause`；写成 `.delete(x)` 传裸字符串更糟——它被当成
过滤对象展开成 `?0=eq.<字符>`，返回 400 且**在 UI 上表现为点了没反应、不报错**。
"移除菜品点了没反应"这个 bug 就是这么来的，排查时一度误判成前端选择器不精确。

**离线写操作**走 `lib/db.js` 的 IndexedDB outbox：只有网络类失败才入队，
业务错误照常抛出（不能静默吞掉）。主键一律客户端生成（`uuid()`，
带非安全上下文降级实现），这样"建单 → 加明细 → 确认"整条链在离线时也能排队重放。

**图片**：`lib/upload.js` 在浏览器里压到最长边 800px / WebP / 目标 ≤200KB 再传，
不给原图上传留通路。`tools/img.mjs` 是同一件事的命令行版本（归一底色 + 缩放）。

## 37.8 还没做 / 需要你决定

| 事项 | 说明 |
|---|---|
| 反代域名 | 见 37.1.2。**不做这步，app 只有装了代理的你自己能用** |
| keep-alive 验证 | 推仓库、配 Secrets、手动 Run、开失败邮件通知 |
| 视觉核对 | 内置浏览器面板当时不可见，6 个页面只做了结构化验证（DOM/数据/零报错），没截图比对设计稿 |
| 深色纸底 | 目前只有浅色。真要做需重出一版插画，不能靠滤镜反色 |
| 早餐 / 火锅独立页 | README 第 7、11 节的页面还没单独成页，目前靠 Order 页的分类切换覆盖 |


---

## 项目核心原则

> **简单、免费、移动端优先、数据驱动、业务与界面分离、为多端扩展预留空间。**

第一阶段不追求复杂，而是先把：

> **菜品 → 筛选 → 点餐 → 随机 → 历史**

这条核心链路跑通。
