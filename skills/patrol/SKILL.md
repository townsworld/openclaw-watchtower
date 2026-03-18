---
name: watchtower-patrol
description: |
  线上服务异常巡查编排。当 Cron 触发巡检或用户要求查看线上异常时，
  使用 watchtower_sentry 获取异常数据，再用 code_agent 分析代码根因。
---

# 线上异常巡查

## 触发条件

- Cron 定时触发（消息中包含"巡检"、"patrol"、"查异常"等关键词）
- 用户主动要求查看线上报错

## 执行流程

### Step 1：获取 Sentry 新异常

调用 `watchtower_sentry` 工具，获取最近一段时间的未解决异常：

```json
{ "minutes": 15 }
```

如果返回"No new issues"，告知用户当前无新异常，结束流程。

### Step 2：逐个分析异常代码

对 `watchtower_sentry` 返回的每个异常，提取以下信息：
- 异常类型和消息（Exception 字段）
- 应用代码的堆栈帧（Stack trace 中 inApp 的部分）
- culprit（出错的类/方法）

然后调用 `code_agent` 工具进行代码分析。根据 Sentry issue 中的 project slug，匹配 `code_agent` 中已配置的同名项目：

```json
{
  "project": "<Sentry project slug 对应的 code_agent 项目名>",
  "mode": "ask",
  "prompt": "在项目中查找 {culprit} 的代码（位于 {file}:{line}），结合异常信息 '{exceptionType}: {exceptionMessage}' 分析可能的出错原因和修复方向。只需要分析根因和给出修复建议，不要修改代码。"
}
```

**重要规则**：
- 一次巡检最多分析 3 个异常，优先分析 level 为 fatal 和 error 的
- 每个异常的 code_agent 调用必须串行执行，等上一个完成后再执行下一个
- 如果 code_agent 调用失败或超时，跳过该异常继续下一个
- 如果 Sentry project slug 在 code_agent 中没有对应项目，跳过代码分析，只输出 Sentry 异常信息

### Step 3：汇总报告

将所有分析结果整理为一份报告，格式如下：

```
[线上异常巡查报告]

共发现 N 个新异常，已分析 M 个：

1. [项目名] 异常标题
   级别：error | 频次：X 次 | 影响用户：Y
   异常：ExceptionType: message
   堆栈：ClassName.method() at file:line
   
   代码分析：
   （code_agent 的分析结果）
   
   Sentry：链接

2. ...
```

### Step 4：输出

将报告通过飞书发送给用户。如果是 Cron 触发的，发送给配置的飞书用户。

## 注意事项

- `watchtower_sentry` 负责从 Sentry 获取数据，`code_agent` 负责代码分析，不要混淆两者的职责
- 不要尝试自己分析代码，所有代码相关的分析都交给 `code_agent`
- 如果没有配置 code_agent 或对应项目，只输出 Sentry 异常信息，跳过代码分析步骤
