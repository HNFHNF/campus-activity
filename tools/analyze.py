# -*- coding: utf-8 -*-
"""实验三 数据分析脚本（V3.0）

输入：项目数据/data 下教师提供的 V2.0 模拟运行数据（UTF-8 with BOM）。
输出：
  - analysis/summary.json        结构化统计结果（含统计口径与需求映射）
  - analysis/tables/*.csv        可复核的明细/汇总表
  - analysis/figures/*.svg       报告用图（另可由 tools/render_figures.py 转 PNG）

脚本只依赖 Python 标准库，避免因环境缺少 pandas/matplotlib 而无法复现。
所有比例均在 summary.json 的 definitions 中写明分子、分母与筛选条件。
"""
from __future__ import annotations

import csv
import json
import os
import statistics
from collections import Counter, defaultdict
from datetime import datetime
from html import escape

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
DATA = os.path.join(ROOT, '项目数据', 'data')
ANALYSIS = os.path.join(ROOT, 'analysis')
FIG = os.path.join(ANALYSIS, 'figures')
TABLES = os.path.join(ANALYSIS, 'tables')
os.makedirs(FIG, exist_ok=True)
os.makedirs(TABLES, exist_ok=True)


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def read_csv(name: str) -> list[dict[str, str]]:
    path = os.path.join(DATA, name)
    with open(path, encoding='utf-8-sig', newline='') as fh:
        return list(csv.DictReader(fh))


def parse_dt(value: str) -> datetime:
    return datetime.strptime(value.strip(), '%Y-%m-%d %H:%M:%S')


def ratio(part: float, total: float, digits: int = 1) -> float:
    return round(part / total * 100, digits) if total else 0.0


def pct(value: float, digits: int = 1) -> float:
    return round(value * 100, digits)


def quantiles(values: list[float], points: tuple[float, ...] = (0.5, 0.9, 0.95, 0.99)) -> dict[str, float]:
    if not values:
        return {f'p{int(p * 100)}': 0.0 for p in points}
    ordered = sorted(values)
    result = {}
    for p in points:
        index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * p))))
        result[f'p{int(p * 100)}'] = round(float(ordered[index]), 1)
    return result


def latency_stats(values: list[float]) -> dict[str, float]:
    if not values:
        return {'n': 0, 'mean': 0, 'p50': 0, 'p90': 0, 'p95': 0, 'p99': 0, 'max': 0}
    return {
        'n': len(values),
        'mean': round(statistics.mean(values), 1),
        **quantiles(values),
        'max': round(max(values), 1),
    }


def write_csv(name: str, header: list[str], rows: list[list[object]]) -> None:
    with open(os.path.join(TABLES, name), 'w', encoding='utf-8-sig', newline='') as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)


def save_json(name: str, data: object) -> None:
    with open(os.path.join(ANALYSIS, name), 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 读取数据
# ---------------------------------------------------------------------------
activities = read_csv('activity.csv')
behaviors = read_csv('user_behavior.csv')
registrations = read_csv('registration_log.csv')
waitlist_changes = read_csv('waitlist_log.csv')
feedback = read_csv('feedback.csv')
system_logs = read_csv('system_log.csv')

activity_by_id = {row['activity_id']: row for row in activities}
activity_ids = [row['activity_id'] for row in activities]

# 行为表存在“完全重复采集”的行：按整行去重后再做行为统计
seen = set()
behaviors_clean: list[dict[str, str]] = []
duplicate_behavior_rows = 0
for row in behaviors:
    key = tuple(row.get(k, '') for k in ('event_id', 'event_ts', 'student_id', 'session_id',
                                         'activity_id', 'page', 'event_name', 'device'))
    if key in seen:
        duplicate_behavior_rows += 1
        continue
    seen.add(key)
    behaviors_clean.append(row)


# ---------------------------------------------------------------------------
# 1. 数据概览与质量
# ---------------------------------------------------------------------------
def span(rows: list[dict[str, str]], column: str) -> dict[str, str]:
    values = [row[column] for row in rows if row.get(column)]
    return {'min': min(values), 'max': max(values)} if values else {'min': '', 'max': ''}


data_quality = {
    'behavior_rows_raw': len(behaviors),
    'behavior_exact_duplicate_rows': duplicate_behavior_rows,
    'behavior_rows_after_dedup': len(behaviors_clean),
    'behavior_missing_student_id': sum(1 for r in behaviors_clean if not r['student_id']),
    'behavior_missing_device': sum(1 for r in behaviors_clean if not r['device']),
    'behavior_missing_activity_id': sum(1 for r in behaviors_clean if not r['activity_id']),
    'registration_missing_fields': sum(
        1 for r in registrations
        if any(not r[k] for k in ('request_id', 'request_ts', 'student_id', 'activity_id', 'action', 'result'))
    ),
    'waitlist_missing_fields': sum(
        1 for r in waitlist_changes
        if any(not r[k] for k in ('change_id', 'application_id', 'student_id', 'activity_id', 'change_ts',
                                  'old_status', 'new_status', 'reason_code'))
    ),
    'system_log_missing_request_id': sum(1 for r in system_logs if not r['request_id']),
    'system_log_registration_events': sum(1 for r in system_logs if r['component'] == 'registration_api'),
    'registration_requests': len(registrations),
    'note': '行为表存在 28 行完全重复采集，已在行为统计中剔除；'
            'system_log 只覆盖部分业务请求（485 条 registration_api 日志 / 2878 条报名请求），'
            '因此系统日志只用于“慢请求与错误事件”的计数，不用于推算全量请求占比。',
}

overview = {
    'period': {
        'behavior': span(behaviors_clean, 'event_ts'),
        'registration': span(registrations, 'request_ts'),
        'waitlist': span(waitlist_changes, 'change_ts'),
        'system_log': span(system_logs, 'event_ts'),
        'feedback': span(feedback, 'submit_ts'),
    },
    'activities': len(activities),
    'activity_categories': dict(Counter(a['category'] for a in activities)),
    'total_capacity': sum(int(a['capacity']) for a in activities),
    'capacity_range': [min(int(a['capacity']) for a in activities), max(int(a['capacity']) for a in activities)],
    'registered_students': len({r['student_id'] for r in registrations}),
    'behavior_students': len({r['student_id'] for r in behaviors_clean if r['student_id']}),
    'behavior_sessions': len({r['session_id'] for r in behaviors_clean if r['session_id']}),
    'feedback_rows': len(feedback),
    'feedback_unique_texts': len({r['feedback_text'] for r in feedback}),
    'feedback_students': len({r['student_id'] for r in feedback}),
    'system_logs': len(system_logs),
    'rows': {
        'activity': len(activities),
        'user_behavior': len(behaviors),
        'registration_log': len(registrations),
        'waitlist_log': len(waitlist_changes),
        'feedback': len(feedback),
        'system_log': len(system_logs),
    },
}


# ---------------------------------------------------------------------------
# 2. 报名业务：请求结果、耗时、时间分布
# ---------------------------------------------------------------------------
result_counts = Counter(r['result'] for r in registrations)
action_counts = Counter(r['action'] for r in registrations)
registration = {
    'requests': len(registrations),
    'actions': dict(action_counts),
    'results': dict(result_counts),
    'result_ratio_of_all_requests': {k: ratio(v, len(registrations)) for k, v in result_counts.items()},
    'apply_requests': sum(1 for r in registrations if r['action'] == 'apply'),
    'cancel_requests': sum(1 for r in registrations if r['action'] == 'cancel'),
    'apply_success_accepted': result_counts.get('accepted', 0),
    'apply_success_ratio_of_apply': ratio(result_counts.get('accepted', 0),
                                          sum(1 for r in registrations if r['action'] == 'apply')),
    'apply_waitlisted': result_counts.get('waitlisted', 0),
    'apply_duplicate': result_counts.get('duplicate', 0),
    'apply_duplicate_ratio_of_apply': ratio(result_counts.get('duplicate', 0),
                                            sum(1 for r in registrations if r['action'] == 'apply')),
    'apply_capacity_conflict': result_counts.get('capacity_conflict', 0),
    'apply_server_error': result_counts.get('server_error', 0),
    'unclear_or_failed_events': result_counts.get('duplicate', 0) + result_counts.get('capacity_conflict', 0)
                                 + result_counts.get('server_error', 0),
    'unclear_or_failed_ratio_of_all_requests': ratio(
        result_counts.get('duplicate', 0) + result_counts.get('capacity_conflict', 0)
        + result_counts.get('server_error', 0), len(registrations)),
    'client_retry': {
        'total': sum(1 for r in registrations if r['client_retry'] == '1'),
        'all_are_duplicate': all(r['result'] == 'duplicate' for r in registrations if r['client_retry'] == '1'),
        'ratio_of_all_requests': ratio(sum(1 for r in registrations if r['client_retry'] == '1'),
                                       len(registrations)),
    },
    'latency_ms_by_result': {
        key: latency_stats([int(r['latency_ms']) for r in registrations if r['result'] == key])
        for key in ('accepted', 'waitlisted', 'duplicate', 'capacity_conflict', 'server_error', 'cancelled')
    },
    'latency_ms_all': latency_stats([int(r['latency_ms']) for r in registrations]),
}

# 报名请求相对活动“报名开放时间”的位置（分钟）
offsets: list[tuple[float, dict[str, str]]] = []
for row in registrations:
    activity = activity_by_id[row['activity_id']]
    delta = (parse_dt(row['request_ts']) - parse_dt(activity['registration_open'])).total_seconds() / 60
    offsets.append((delta, row))

apply_total = sum(1 for r in registrations if r['action'] == 'apply')
time_distribution: dict[str, dict[str, float]] = {}
for minutes in (1, 5, 10, 30, 60, 180, 720, 1440):
    count = sum(1 for delta, _ in offsets if 0 <= delta <= minutes)
    apply_count = sum(1 for delta, row in offsets if row['action'] == 'apply' and 0 <= delta <= minutes)
    time_distribution[f'within_{minutes}min'] = {
        'count': count,
        'ratio_of_all_requests': ratio(count, len(registrations)),
        'apply_count': apply_count,
        'ratio_of_apply_requests': ratio(apply_count, apply_total),
    }
registration['time_from_registration_open'] = time_distribution
registration['requests_before_open'] = sum(1 for delta, _ in offsets if delta < 0)

# 开放后 10 分钟高峰 vs 其余时间
peak_latency = [int(r['latency_ms']) for delta, r in offsets if r['action'] == 'apply' and 0 <= delta <= 10]
normal_latency = [int(r['latency_ms']) for delta, r in offsets if r['action'] == 'apply' and delta > 10]
registration['peak_window'] = {
    'definition': '报名开放后 0–10 分钟内的 apply 请求（高峰窗口）',
    'requests': len(peak_latency),
    'ratio_of_apply_requests': ratio(len(peak_latency), apply_total),
    'latency_ms': latency_stats(peak_latency),
    'other_latency_ms': latency_stats(normal_latency),
    'slow_ratio_peak': ratio(sum(1 for v in peak_latency if v >= 1000), len(peak_latency)),
    'slow_ratio_other': ratio(sum(1 for v in normal_latency if v >= 1000), len(normal_latency)),
}


# ---------------------------------------------------------------------------
# 3. 报名状态回放：最终正式 / 候补，供需与取消
# ---------------------------------------------------------------------------
# 事件回放：apply（accepted/waitlisted 改变状态）、cancel（删除报名）、waitlist 状态变化。
# 不能直接把 accepted 条数当最终正式人数，因为存在取消与递补。
events: list[tuple[datetime, int, str, dict[str, str]]] = []
for row in registrations:
    events.append((parse_dt(row['request_ts']), 0, 'register', row))
for row in waitlist_changes:
    events.append((parse_dt(row['change_ts']), 1, 'waitlist', row))
events.sort(key=lambda item: (item[0], item[1]))

final_state: dict[tuple[str, str], str] = {}
for _, _, kind, row in events:
    key = (row['student_id'], row['activity_id'])
    if kind == 'register':
        if row['action'] == 'cancel':
            final_state.pop(key, None)
        elif row['result'] == 'accepted':
            final_state[key] = 'confirmed'
        elif row['result'] == 'waitlisted':
            final_state[key] = 'waitlisted'
    else:
        if row['new_status'] == 'waiting':
            final_state[key] = 'waitlisted'
        elif row['new_status'] == 'accepted':
            final_state[key] = 'confirmed'

final_counts = Counter(final_state.values())
final_confirmed_by_activity = Counter(activity for (_, activity), status in final_state.items() if status == 'confirmed')
final_waitlisted_by_activity = Counter(activity for (_, activity), status in final_state.items() if status == 'waitlisted')

# 每活动需求：apply 请求数、去重申请人数、结果、最终状态
per_activity: dict[str, dict[str, object]] = {}
for aid in activity_ids:
    per_activity[aid] = {
        'applications': 0,
        'applicants': set(),
        'accepted': 0,
        'waitlisted': 0,
        'duplicate': 0,
        'capacity_conflict': 0,
        'server_error': 0,
        'cancelled': 0,
        'promoted': 0,
        'waiting_initial': 0,
        'final_confirmed': final_confirmed_by_activity.get(aid, 0),
        'final_waitlisted': final_waitlisted_by_activity.get(aid, 0),
        'slow_requests': 0,
        'server_errors_logged': 0,
    }
for row in registrations:
    item = per_activity[row['activity_id']]
    if row['action'] == 'apply':
        item['applications'] = int(item['applications']) + 1
        item['applicants'].add(row['student_id'])  # type: ignore[union-attr]
        if row['result'] in ('accepted', 'waitlisted', 'duplicate', 'capacity_conflict', 'server_error'):
            item[row['result']] = int(item[row['result']]) + 1
    else:
        item['cancelled'] = int(item['cancelled']) + 1
for row in waitlist_changes:
    item = per_activity[row['activity_id']]
    if row['new_status'] == 'accepted':
        item['promoted'] = int(item['promoted']) + 1
    else:
        item['waiting_initial'] = int(item['waiting_initial']) + 1
for row in system_logs:
    if not row['activity_id']:
        continue
    item = per_activity[row['activity_id']]
    if row['event_code'] == 'SLOW_REQUEST':
        item['slow_requests'] = int(item['slow_requests']) + 1
    if row['event_code'] == 'E500':
        item['server_errors_logged'] = int(item['server_errors_logged']) + 1

activity_rows: list[dict[str, object]] = []
for aid in activity_ids:
    activity = activity_by_id[aid]
    item = per_activity[aid]
    capacity = int(activity['capacity'])
    applicants = len(item['applicants'])  # type: ignore[arg-type]
    applications = int(item['applications'])
    activity_rows.append({
        'activity_id': aid,
        'activity_name': activity['activity_name'],
        'category': activity['category'],
        'capacity': capacity,
        'applications': applications,
        'applicants': applicants,
        'accepted': int(item['accepted']),
        'waitlisted': int(item['waitlisted']),
        'duplicate': int(item['duplicate']),
        'capacity_conflict': int(item['capacity_conflict']),
        'server_error': int(item['server_error']),
        'cancelled': int(item['cancelled']),
        'promoted': int(item['promoted']),
        'final_confirmed': int(item['final_confirmed']),
        'final_waitlisted': int(item['final_waitlisted']),
        'demand_ratio': round(applicants / capacity, 2) if capacity else 0,
        'waitlist_ratio': round(int(item['final_waitlisted']) / capacity, 2) if capacity else 0,
        'slow_requests': int(item['slow_requests']),
    })
activity_rows.sort(key=lambda row: (-float(row['demand_ratio']), str(row['activity_id'])))

hot_threshold = 2.0
hot_activities = [row for row in activity_rows if float(row['demand_ratio']) >= hot_threshold]
hot_capacity = sum(int(row['capacity']) for row in hot_activities)
hot_applicants = sum(int(row['applicants']) for row in hot_activities)
hot_waitlisted = sum(int(row['final_waitlisted']) for row in hot_activities)
hot_slow = sum(int(row['slow_requests']) for row in hot_activities)
all_applicants = sum(int(row['applicants']) for row in activity_rows)
all_waitlisted = sum(int(row['final_waitlisted']) for row in activity_rows)

demand = {
    'definition': '供需比 = 去重申请学生数 / 活动容量；申请人数按 (student_id, activity_id) 去重，避免重复提交放大需求。',
    'top_activities': activity_rows[:12],
    'hot_activities': hot_activities,
    'hot_threshold': hot_threshold,
    'hot_activity_count': len(hot_activities),
    'hot_share': {
        'capacity': hot_capacity,
        'capacity_ratio_of_all': ratio(hot_capacity, overview['total_capacity']),
        'applicants': hot_applicants,
        'applicants_ratio_of_all': ratio(hot_applicants, all_applicants),
        'waitlisted': hot_waitlisted,
        'waitlisted_ratio_of_all': ratio(hot_waitlisted, all_waitlisted),
        'slow_requests': hot_slow,
        'slow_requests_ratio_of_all': ratio(hot_slow, sum(int(row['slow_requests']) for row in activity_rows)),
    },
    'undersubscribed_count': sum(1 for row in activity_rows if float(row['demand_ratio']) < 1.0),
}

# 候补：申请数、转正数、仍候补数、递补等待时间
waitlist_application_ids = {row['application_id'] for row in waitlist_changes}
waitlist_by_application: dict[str, list[dict[str, str]]] = defaultdict(list)
for row in waitlist_changes:
    waitlist_by_application[row['application_id']].append(row)
promotion_waits: list[float] = []
never_promoted = 0
for changes in waitlist_by_application.values():
    changes.sort(key=lambda row: row['change_ts'])
    waiting = [row for row in changes if row['new_status'] == 'waiting']
    accepted = [row for row in changes if row['new_status'] == 'accepted']
    if waiting and accepted:
        promotion_waits.append((parse_dt(accepted[0]['change_ts']) - parse_dt(waiting[0]['change_ts'])).total_seconds() / 3600)
    else:
        never_promoted += 1
cancel_times = sorted(parse_dt(row['request_ts']) for row in registrations if row['action'] == 'cancel')
promotion_times = sorted(parse_dt(row['change_ts']) for row in waitlist_changes if row['new_status'] == 'accepted')
cancel_to_promotion_seconds = [
    (promotion_times[i] - cancel_times[i]).total_seconds()
    for i in range(min(len(cancel_times), len(promotion_times)))
]

waitlist = {
    'applications': len(waitlist_application_ids),
    'promoted': len(promotion_waits),
    'promotion_ratio': ratio(len(promotion_waits), len(waitlist_application_ids)),
    'still_waitlisted_at_observation_end': final_counts.get('waitlisted', 0),
    'still_waitlisted_ratio': ratio(final_counts.get('waitlisted', 0), len(waitlist_application_ids)),
    'promotion_wait_hours': latency_stats(promotion_waits),
    'cancel_requests': len(cancel_times),
    'cancel_to_promotion_seconds': {
        'median': round(statistics.median(cancel_to_promotion_seconds), 1) if cancel_to_promotion_seconds else 0,
        'max': round(max(cancel_to_promotion_seconds), 1) if cancel_to_promotion_seconds else 0,
        'definition': '按取消请求与递补转正记录的时间排序后一一配对（观测数据中 130 次取消对应 130 次递补）。',
    },
    'reason_codes': dict(Counter(row['reason_code'] for row in waitlist_changes)),
}

# 最终正式人数与取消率
ever_confirmed = result_counts.get('accepted', 0) + len(promotion_waits)
cancellation = {
    'cancel_requests': result_counts.get('cancelled', 0),
    'ever_confirmed_including_promoted': ever_confirmed,
    'cancel_ratio_of_ever_confirmed': ratio(result_counts.get('cancelled', 0), ever_confirmed),
    'final_confirmed': final_counts.get('confirmed', 0),
    'final_waitlisted': final_counts.get('waitlisted', 0),
    'note': '最终正式人数 = 首轮 accepted + 候补递补转正 - 取消，按时间顺序回放。',
}


# ---------------------------------------------------------------------------
# 4. 行为漏斗、设备与页面
# ---------------------------------------------------------------------------
page_counts = Counter(row['page'] for row in behaviors_clean)
event_counts = Counter(row['event_name'] for row in behaviors_clean)
device_counts = Counter(row['device'] for row in behaviors_clean)
session_pages: dict[str, Counter[str]] = defaultdict(Counter)
student_pages: dict[str, Counter[str]] = defaultdict(Counter)
for row in behaviors_clean:
    if row['session_id']:
        session_pages[row['session_id']][row['page']] += 1
    if row['student_id']:
        student_pages[row['student_id']][row['page']] += 1

sessions = len(session_pages)
session_page_counts = {
    'activity_list': sum(1 for pages in session_pages.values() if pages['activity_list'] > 0),
    'activity_detail': sum(1 for pages in session_pages.values() if pages['activity_detail'] > 0),
    'registration': sum(1 for pages in session_pages.values() if pages['registration'] > 0),
    'registration_status': sum(1 for pages in session_pages.values() if pages['registration_status'] > 0),
}
registration_sessions = session_page_counts['registration']
status_sessions = session_page_counts['registration_status']
behavior = {
    'rows_used': len(behaviors_clean),
    'page_counts': dict(page_counts),
    'event_counts': dict(event_counts),
    'sessions': sessions,
    'students': len(student_pages),
    'pages_per_session': {
        'median': statistics.median(sum(pages.values()) for pages in session_pages.values()),
        'mean': round(statistics.mean(sum(pages.values()) for pages in session_pages.values()), 1),
    },
    'funnel': {
        'sessions_with_list': session_page_counts['activity_list'],
        'sessions_with_list_and_detail': sum(
            1 for pages in session_pages.values() if pages['activity_list'] > 0 and pages['activity_detail'] > 0),
        'sessions_with_registration_page': registration_sessions,
        'sessions_with_status_page': status_sessions,
        'ratio_list_and_detail': ratio(
            sum(1 for pages in session_pages.values() if pages['activity_list'] > 0 and pages['activity_detail'] > 0),
            sessions),
        'ratio_registration_page': ratio(registration_sessions, sessions),
        'ratio_status_page': ratio(status_sessions, sessions),
        'detail_views_per_list_view': round(page_counts['activity_detail'] / page_counts['activity_list'], 2)
        if page_counts['activity_list'] else 0,
        'note': '行为表只保证页面访问被记录，不保证会话内完整路径；漏斗按“会话中是否出现该页面”统计，不代表严格顺序。',
    },
    'per_student_median': {
        'list_views': statistics.median(pages['activity_list'] for pages in student_pages.values()),
        'detail_views': statistics.median(pages['activity_detail'] for pages in student_pages.values()),
        'status_views': statistics.median(pages['registration_status'] for pages in student_pages.values()),
    },
    'device': {
        'counts': dict(device_counts),
        'ratios': {key: ratio(value, len(behaviors_clean)) for key, value in device_counts.items()},
        'registration_page_device': dict(Counter(
            row['device'] for row in behaviors_clean if row['page'] == 'registration' and row['device'])),
        'status_page_device': dict(Counter(
            row['device'] for row in behaviors_clean if row['page'] == 'registration_status' and row['device'])),
        'note': '移动端（mobile）占全部行为事件的 70.9%；报名页与状态页中移动端占比更高（74.9%、78.2%）。',
    },
    'hour_distribution': dict(sorted(Counter(parse_dt(row['event_ts']).hour for row in behaviors_clean).items())),
}
# 移动端占比（报名页/状态页）
behavior['device']['mobile_share_registration_page'] = ratio(
    behavior['device']['registration_page_device'].get('mobile', 0), page_counts['registration'])
behavior['device']['mobile_share_status_page'] = ratio(
    behavior['device']['status_page_device'].get('mobile', 0), page_counts['registration_status'])


# ---------------------------------------------------------------------------
# 5. 匿名反馈：按语义主题编码（可多标签）
# ---------------------------------------------------------------------------
theme_rules: dict[str, list[str]] = {
    '状态变化不可感知/需要自己查': ['候补结果', '自己去查状态', '登录后才知道', '已经是成功',
                                  '隔了两天', '报名结果的变化', '专门去页面查看', '排队'],
    '提交结果不明确/重复提交': ['不清楚原因', '又试了一次', '连点', '连续点了两次',
                            '不确定到底有没有提交成功', '卡住之后我又点了一次', '提示内容有点难理解'],
    '发现与筛选效率': ['标题看着差不多', '查起来有点费时间', '一条条打开', '翻了几轮',
                  '逐个看', '想找周末的活动', '试了几次才看到时间合适的', '只想参加一类'],
    '时间冲突': ['时间和课程冲突'],
    '地点说明': ['地点说明'],
    '正向评价': ['比较顺利', '比较齐全', '很顺畅', '组织得不错', '基本都能查到', '比较方便',
               '目前用起来还可以'],
}
feedback_students = {row['student_id'] for row in feedback}
feedback_themes = []
theme_hits: dict[str, set[int]] = defaultdict(set)
for theme, keywords in theme_rules.items():
    hit_indexes = {
        index for index, row in enumerate(feedback)
        if any(keyword in row['feedback_text'] for keyword in keywords)
    }
    theme_hits[theme] = hit_indexes
    students = {feedback[index]['student_id'] for index in hit_indexes}
    feedback_themes.append({
        'theme': theme,
        'feedback_rows': len(hit_indexes),
        'ratio_of_feedback_rows': ratio(len(hit_indexes), len(feedback)),
        'unique_students': len(students),
        'ratio_of_feedback_students': ratio(len(students), len(feedback_students)),
        'keywords': keywords,
    })
feedback_themes.sort(key=lambda item: -int(item['feedback_rows']))
multi_label_rows = sum(1 for index in range(len(feedback)) if sum(1 for hits in theme_hits.values() if index in hits) > 1)
feedback_stats = {
    'rows': len(feedback),
    'unique_texts': overview['feedback_unique_texts'],
    'unique_students': len(feedback_students),
    'themes': feedback_themes,
    'multi_label_rows': multi_label_rows,
    'note': '反馈是非结构化、非随机样本：112 条反馈来自 96 名学生，只能说明“反馈样本中有人提到”，'
            '不能外推为全体用户比例。主题按关键词规则编码，一条反馈可命中多个主题。',
}


# ---------------------------------------------------------------------------
# 6. 系统日志与响应质量
# ---------------------------------------------------------------------------
registration_api_logs = [row for row in system_logs if row['component'] == 'registration_api']
log_event_counts = Counter(row['event_code'] for row in registration_api_logs)
slow_by_activity = Counter(row['activity_id'] for row in registration_api_logs if row['event_code'] == 'SLOW_REQUEST')
error_by_activity = Counter(row['activity_id'] for row in registration_api_logs if row['event_code'] in ('E500', 'E409'))
performance = {
    'registration_api_log_events': len(registration_api_logs),
    'log_event_counts': dict(log_event_counts),
    'slow_request_count': log_event_counts.get('SLOW_REQUEST', 0),
    'slow_request_ratio_of_logged_events': ratio(log_event_counts.get('SLOW_REQUEST', 0), len(registration_api_logs)),
    'slow_requests_by_activity': dict(slow_by_activity.most_common()),
    'error_events_by_activity': dict(error_by_activity.most_common()),
    'slow_request_latency_ms': latency_stats([
        float(row['elapsed_ms']) for row in registration_api_logs
        if row['event_code'] == 'SLOW_REQUEST' and row['elapsed_ms']
    ]),
    'note': 'system_log 只记录慢请求、错误和部分完成事件，不是全量访问日志；'
            '全量耗时以 registration_log.latency_ms 为准，慢请求事件用于定位活动与时段。',
}


# ---------------------------------------------------------------------------
# 7. 已报名活动的时间重叠（代理口径）
# ---------------------------------------------------------------------------
confirmed_by_student: dict[str, list[str]] = defaultdict(list)
for (student, activity), status in final_state.items():
    if status == 'confirmed':
        confirmed_by_student[student].append(activity)
multi_confirmed = {student: ids for student, ids in confirmed_by_student.items() if len(ids) >= 2}
conflict_students: set[str] = set()
conflict_pairs: list[dict[str, object]] = []
pair_counter: Counter[tuple[str, str]] = Counter()
for student, ids in multi_confirmed.items():
    times = sorted((parse_dt(activity_by_id[aid]['activity_start']), aid) for aid in ids)
    for i in range(len(times)):
        for j in range(i + 1, len(times)):
            gap = abs((times[j][0] - times[i][0]).total_seconds()) / 3600
            if gap < 2:
                conflict_students.add(student)
                pair_counter[tuple(sorted((times[i][1], times[j][1])))] += 1
                conflict_pairs.append({
                    'student_id': student,
                    'activity_a': times[i][1],
                    'activity_b': times[j][1],
                    'gap_hours': round(gap, 2),
                })
conflict = {
    'definition': '同一学生最终状态为“正式报名”的活动之间，开始时间相差不足 2 小时视为时间重叠。'
                  '数据没有活动结束时间与课表，因此这是保守代理口径，不等于真实冲突时长。',
    'students_with_confirmed': len(confirmed_by_student),
    'students_with_multi_confirmed': len(multi_confirmed),
    'students_with_conflict': len(conflict_students),
    'conflict_ratio_of_multi_confirmed': ratio(len(conflict_students), len(multi_confirmed)),
    'conflict_pairs': len(conflict_pairs),
    'top_activity_pairs': [
        {'activity_a': pair[0], 'activity_b': pair[1], 'students': count}
        for pair, count in pair_counter.most_common(10)
    ],
    'note': '反馈中另有 4 条提到“活动时间和课程冲突”，但数据包没有课表，无法量化课程冲突。',
}


# ---------------------------------------------------------------------------
# 8. 需求映射与结论（供报告/README 引用）
# ---------------------------------------------------------------------------
requirements = [
    {
        'id': 'R1',
        'name': '报名状态变化通知与状态时间线',
        'evidence': [
            f'候补申请 {waitlist["applications"]} 条，其中 {waitlist["promoted"]} 条在观测期内转正'
            f'（{waitlist["promotion_ratio"]}%），转正等待中位数 {waitlist["promotion_wait_hours"].get("p50", 0)} 小时；'
            f'观测结束时仍有 {waitlist["still_waitlisted_at_observation_end"]} 条候补未转正。',
            f'反馈样本中 {next(t for t in feedback_themes if t["theme"].startswith("状态变化"))["feedback_rows"]}/112 条提到'
            '“不知道候补结果/需要自己查状态/隔两天才发现”。',
            f'行为数据中 {behavior["funnel"]["sessions_with_status_page"]} 个会话（{behavior["funnel"]["ratio_status_page"]}%）'
            '访问过报名状态页。',
        ],
        'decision': '保留并强化 V3.0 通知中心：候补转正、审核通过/未通过、关闭审核后的自动处理、活动下架均写入站内通知，'
                    '“我的活动”增加状态筛选与“状态更新时间”。',
    },
    {
        'id': 'R2',
        'name': '报名提交的确定性与幂等防重',
        'evidence': [
            f'申请请求中 {registration["apply_duplicate"]} 条为 duplicate（{registration["apply_duplicate_ratio_of_apply"]}%），'
            f'{registration["client_retry"]["total"]} 条客户端重试请求全部为 duplicate；另有 '
            f'{registration["apply_capacity_conflict"]} 条 capacity_conflict、{registration["apply_server_error"]} 条 server_error。',
            '反馈样本中 19/112 条提到“不确定是否提交成功/页面卡住又点了一次/失败原因不清楚”。',
            f'报名请求整体 P95 耗时 {registration["latency_ms_all"]["p95"]} ms；开放后 10 分钟高峰窗口的 P95 为 '
            f'{registration["peak_window"]["latency_ms"]["p95"]} ms。',
        ],
        'decision': '提交按钮增加进行中状态与防重复点击；服务端按 request_token 幂等处理，重复提交返回同一报名状态；'
                    '失败结果给出可理解的原因和重试入口，并回显报名回执编号。',
    },
    {
        'id': 'R3',
        'name': '移动端可用性',
        'evidence': [
            f'行为事件中移动端占 {behavior["device"]["ratios"].get("mobile", 0)}%，桌面端 '
            f'{behavior["device"]["ratios"].get("desktop", 0)}%，平板端 {behavior["device"]["ratios"].get("tablet", 0)}%。',
            f'报名页移动端占 {behavior["device"]["mobile_share_registration_page"]}%，状态页移动端占 '
            f'{behavior["device"]["mobile_share_status_page"]}%。',
        ],
        'decision': '增加移动端底部导航与响应式布局，详情页在窄屏下全屏展示，表格页可横向/折叠查看；'
                    '桌面端保持原有侧边栏。',
    },
    {
        'id': 'R4',
        'name': '发现与筛选效率',
        'evidence': [
            f'反馈样本中 {next(t for t in feedback_themes if t["theme"] == "发现与筛选效率")["feedback_rows"]}/112 条'
            '提到标题相似、需要逐个打开、周末筛选困难或只想看一类活动。',
            f'行为数据中详情页访问 {page_counts["activity_detail"]} 次、列表页访问 {page_counts["activity_list"]} 次，'
            f'详情/列表 = {behavior["funnel"]["detail_views_per_list_view"]}；学生个人中位数列表 {behavior["per_student_median"]["list_views"]} 次、'
            f'详情 {behavior["per_student_median"]["detail_views"]} 次。',
        ],
        'decision': '活动广场增加“仅看有名额/仅看周末/按时间或剩余名额排序”，搜索扩展到主办方与活动介绍；'
                    '活动卡片直接展示时间、地点、剩余名额与候补人数，减少打开详情才能判断的成本。',
    },
    {
        'id': 'R5',
        'name': '供需失衡的教师端概览与备选推荐',
        'evidence': [
            f'{len(hot_activities)} 个供需比 ≥ {hot_threshold} 的活动只占总容量 {demand["hot_share"]["capacity_ratio_of_all"]}%，'
            f'却获得 {demand["hot_share"]["applicants_ratio_of_all"]}% 的申请、{demand["hot_share"]["waitlisted_ratio_of_all"]}% 的候补；'
            f'全部 {performance["slow_request_count"]} 条慢请求都集中在这些活动上。',
            f'供需比最高的活动：{", ".join(f"{row['activity_name']}({row['demand_ratio']})" for row in hot_activities[:5])}。',
        ],
        'decision': '教师端“活动管理”展示每个活动的报名申请、正式/候补/待审核结构与供需比，并给出“增加名额/加开场次”提示；'
                    '学生端在满员活动详情中推荐同类且仍有余量的活动。',
    },
    {
        'id': 'R6',
        'name': '报名时间冲突聚合提醒',
        'evidence': [
            f'有 {len(multi_confirmed)} 名学生最终正式报名了 ≥2 个活动，其中 {len(conflict_students)} 名'
            f'（{conflict["conflict_ratio_of_multi_confirmed"]}%）存在开始时间相差不足 2 小时的活动，共 {len(conflict_pairs)} 对。',
            '反馈样本中另有 4/112 条提到活动时间与课程冲突，但数据包没有课表，无法量化课程冲突。',
        ],
        'decision': '保留“我的活动”页的冲突聚合卡片，并在列表卡片上标出冲突个数；口径保持“开始时间相差 < 2 小时”。',
    },
]


summary = {
    'meta': {
        'title': '实验三 基于运行数据的需求演化｜V2.0 模拟运行数据分析',
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'data_dir': '项目数据/data',
        'files': ['activity.csv', 'user_behavior.csv', 'registration_log.csv', 'waitlist_log.csv',
                  'feedback.csv', 'system_log.csv', '字段字典.csv'],
        'tool': 'Python 3 标准库（csv/json/statistics/collections）',
        'analysis_script': 'tools/analyze.py',
    },
    'definitions': {
        'request': 'registration_log.csv 的一行，代表一次报名/取消业务请求；同一学生可因重试产生多条请求。',
        'apply_request': 'action=apply 的请求；duplicate/capacity_conflict/server_error 都是未成功产生新报名的请求。',
        'unique_applicant': '按 (student_id, activity_id) 去重后的申请学生数，用于供需比，避免重试放大需求。',
        'demand_ratio': '去重申请学生数 ÷ 活动容量（capacity）。',
        'final_state': '把 registration_log 与 waitlist_log 按时间回放后的最终报名状态：confirmed 或 waitlisted。',
        'promotion_ratio': 'waitlist_log 中最终转为 accepted 的候补申请数 ÷ 进入过 waiting 的候补申请数。',
        'status_page_ratio': '访问过 registration_status 页面的会话数 ÷ 有 session_id 的会话数。',
        'feedback_ratio': '命中的反馈条数 ÷ 112 条反馈；反馈是非随机样本，不能外推到全体学生。',
        'peak_window': '报名开放后 0–10 分钟内的 apply 请求；用于对比高峰与其余时段的耗时。',
        'conflict': '同一学生最终正式报名的活动之间，开始时间相差 < 2 小时；缺少结束时间与课表，属于代理口径。',
    },
    'overview': overview,
    'data_quality': data_quality,
    'registration': registration,
    'final_registration_state': {
        'counts': dict(final_counts),
        'students': len({student for (student, _) in final_state}),
        'by_activity': [
            {
                'activity_id': row['activity_id'],
                'capacity': row['capacity'],
                'final_confirmed': row['final_confirmed'],
                'final_waitlisted': row['final_waitlisted'],
            }
            for row in activity_rows
        ],
    },
    'cancellation': cancellation,
    'waitlist': waitlist,
    'demand': demand,
    'behavior': behavior,
    'feedback': feedback_stats,
    'performance': performance,
    'conflict': conflict,
    'requirements': requirements,
    'limitations': [
        '数据是教师提供的 V2.0 模拟运行数据，不是本组 V3.0 的实际运行日志；结论只用于需求判断。',
        'system_log 只覆盖部分业务请求（485/2878），不能据此计算全量错误率；错误率以 registration_log 为准。',
        'feedback 是非结构化、非随机样本（112 条/96 人），只能作为线索，不能代表全体用户比例。',
        '行为表不保证会话完整路径，漏斗按“会话中是否出现页面”统计，不代表严格步骤转化。',
        '活动表没有结束时间、课表和签到数据，无法计算真实冲突时长、到场率或满意度评分。',
        '候补转正等待时间受观测窗口截断影响（观测结束时仍有 746 条候补），不能解释为平均等待时间。',
    ],
}


# ---------------------------------------------------------------------------
# 9. 输出表格
# ---------------------------------------------------------------------------
write_csv(
    'activity_demand.csv',
    ['activity_id', 'activity_name', 'category', 'capacity', 'applications', 'applicants', 'accepted',
     'waitlisted', 'duplicate', 'capacity_conflict', 'server_error', 'cancelled', 'promoted',
     'final_confirmed', 'final_waitlisted', 'demand_ratio', 'waitlist_ratio', 'slow_requests'],
    [[row[key] for key in ('activity_id', 'activity_name', 'category', 'capacity', 'applications', 'applicants',
                           'accepted', 'waitlisted', 'duplicate', 'capacity_conflict', 'server_error',
                           'cancelled', 'promoted', 'final_confirmed', 'final_waitlisted', 'demand_ratio',
                           'waitlist_ratio', 'slow_requests')] for row in activity_rows],
)
write_csv(
    'feedback_themes.csv',
    ['theme', 'feedback_rows', 'ratio_of_feedback_rows', 'unique_students', 'ratio_of_feedback_students'],
    [[row['theme'], row['feedback_rows'], row['ratio_of_feedback_rows'], row['unique_students'],
      row['ratio_of_feedback_students']] for row in feedback_themes],
)
write_csv(
    'funnel.csv',
    ['stage', 'sessions', 'ratio_of_sessions'],
    [
        ['列表+详情', behavior['funnel']['sessions_with_list_and_detail'], behavior['funnel']['ratio_list_and_detail']],
        ['进入报名页', behavior['funnel']['sessions_with_registration_page'], behavior['funnel']['ratio_registration_page']],
        ['查看报名状态', behavior['funnel']['sessions_with_status_page'], behavior['funnel']['ratio_status_page']],
    ],
)
write_csv(
    'latency.csv',
    ['scope', 'n', 'mean', 'p50', 'p90', 'p95', 'p99', 'max'],
    [['all', registration['latency_ms_all']['n'], registration['latency_ms_all']['mean'],
      registration['latency_ms_all']['p50'], registration['latency_ms_all']['p90'],
      registration['latency_ms_all']['p95'], registration['latency_ms_all']['p99'],
      registration['latency_ms_all']['max']]]
    + [[key, stats['n'], stats['mean'], stats['p50'], stats['p90'], stats['p95'], stats['p99'], stats['max']]
       for key, stats in registration['latency_ms_by_result'].items()]
    + [['peak_0_10min', registration['peak_window']['latency_ms']['n'], registration['peak_window']['latency_ms']['mean'],
        registration['peak_window']['latency_ms']['p50'], registration['peak_window']['latency_ms']['p90'],
        registration['peak_window']['latency_ms']['p95'], registration['peak_window']['latency_ms']['p99'],
        registration['peak_window']['latency_ms']['max']],
       ['non_peak', registration['peak_window']['other_latency_ms']['n'], registration['peak_window']['other_latency_ms']['mean'],
        registration['peak_window']['other_latency_ms']['p50'], registration['peak_window']['other_latency_ms']['p90'],
        registration['peak_window']['other_latency_ms']['p95'], registration['peak_window']['other_latency_ms']['p99'],
        registration['peak_window']['other_latency_ms']['max']]],
)
write_csv(
    'data_quality.csv',
    ['item', 'value'],
    [[key, json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value]
     for key, value in data_quality.items()],
)
write_csv(
    'conflict_pairs.csv',
    ['student_id', 'activity_a', 'activity_b', 'gap_hours'],
    [[row['student_id'], row['activity_a'], row['activity_b'], row['gap_hours']] for row in conflict_pairs],
)
write_csv(
    'waitlist_promotions.csv',
    ['application_id', 'student_id', 'activity_id', 'wait_hours', 'promoted_at'],
    [
        [
            application_id,
            (changes[0]['student_id'] if changes else ''),
            (changes[0]['activity_id'] if changes else ''),
            round((parse_dt(accepted[0]['change_ts']) - parse_dt(waiting[0]['change_ts'])).total_seconds() / 3600, 2),
            accepted[0]['change_ts'],
        ]
        for application_id, changes in waitlist_by_application.items()
        for waiting in [[row for row in changes if row['new_status'] == 'waiting']]
        for accepted in [[row for row in changes if row['new_status'] == 'accepted']]
        if waiting and accepted
    ],
)

save_json('summary.json', summary)
print(json.dumps({
    'overview': overview['rows'],
    'registration_results': registration['results'],
    'hot_activities': [row['activity_id'] for row in hot_activities],
    'waitlist': {k: waitlist[k] for k in ('applications', 'promoted', 'promotion_ratio',
                                          'still_waitlisted_at_observation_end')},
    'conflict_ratio': conflict['conflict_ratio_of_multi_confirmed'],
    'feedback_themes': [(row['theme'], row['feedback_rows']) for row in feedback_themes],
}, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# 10. SVG 图表（无第三方依赖）
# ---------------------------------------------------------------------------
W, H = 960, 560
C = {
    'blue': '#007aff', 'green': '#34c759', 'orange': '#ff9500', 'red': '#ff3b30',
    'purple': '#af52de', 'gray': '#8e8e93', 'dark': '#1d3040', 'light': '#eef3f9',
    'grid': '#e3e9f2', 'text': '#425466', 'muted': '#7b8794', 'cyan': '#5ac8fa', 'amber': '#ffcc00',
}
FONT = "Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Segoe UI, sans-serif"


def svg_open(width: int = W, height: int = H) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
        f'<g font-family="{FONT}">',
    ]


def svg_close(parts: list[str], name: str) -> None:
    parts.append('</g></svg>')
    with open(os.path.join(FIG, name), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(parts))


def text(x: float, y: float, value: str, size: int = 14, color: str = C['text'],
         anchor: str = 'start', weight: str = 'normal') -> str:
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{color}" '
            f'text-anchor="{anchor}" font-weight="{weight}">{escape(str(value))}</text>')


def title_block(parts: list[str], title: str, subtitle: str = '') -> None:
    parts.append(text(48, 58, title, 24, C['dark'], weight='700'))
    if subtitle:
        parts.append(text(48, 86, subtitle, 13, C['muted']))


def axis_line(parts: list[str], x1: float, y1: float, x2: float, y2: float) -> None:
    parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{C["grid"]}" stroke-width="1"/>')


def bar(parts: list[str], x: float, y: float, width: float, height: float, color: str, radius: float = 4) -> None:
    if height <= 0:
        return
    parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{width:.1f}" height="{height:.1f}" rx="{radius}" fill="{color}"/>')


# 图 1：报名请求结果
parts = svg_open()
title_block(parts, '报名请求结果分布', f'共 {len(registrations)} 条业务请求；duplicate + capacity_conflict + server_error = '
                                      f'{registration["unclear_or_failed_events"]} 条（{registration["unclear_or_failed_ratio_of_all_requests"]}%）')
labels = [('accepted', '正式受理'), ('waitlisted', '进入候补'), ('cancelled', '取消报名'),
          ('duplicate', '重复提交'), ('capacity_conflict', '名额冲突'), ('server_error', '服务错误')]
values = [result_counts.get(key, 0) for key, _ in labels]
colors = [C['green'], C['blue'], C['gray'], C['orange'], C['red'], C['purple']]
chart_x, chart_y, chart_w, chart_h = 90, 120, 780, 350
max_v = max(values)
for tick in range(0, 5):
    value = max_v * tick / 4
    y = chart_y + chart_h - chart_h * tick / 4
    axis_line(parts, chart_x, y, chart_x + chart_w, y)
    parts.append(text(chart_x - 12, y + 4, f'{int(value)}', 11, C['muted'], 'end'))
slot = chart_w / len(labels)
for index, ((key, label), value, color) in enumerate(zip(labels, values, colors)):
    x = chart_x + slot * index + slot * 0.2
    height = chart_h * value / max_v
    bar(parts, x, chart_y + chart_h - height, slot * 0.6, height, color)
    parts.append(text(x + slot * 0.3, chart_y + chart_h - height - 8, f'{value}', 13, C['dark'], 'middle', '700'))
    parts.append(text(x + slot * 0.3, chart_y + chart_h + 24, label, 12, C['text'], 'middle'))
    parts.append(text(x + slot * 0.3, chart_y + chart_h + 42, f'{ratio(value, len(registrations))}%', 11, C['muted'], 'middle'))
parts.append(text(48, 525, '口径：registration_log.csv 全部 2878 条请求，accepted/waitlisted 为成功受理；'
                           'duplicate 为客户端重复提交被识别，capacity_conflict/server_error 未产生报名。', 11, C['muted']))
svg_close(parts, 'fig1_registration_results.svg')

# 图 2：各活动供需
parts = svg_open(height=700)
title_block(parts, '各活动报名需求与容量（供需比前 15）', '供需比 = 去重申请学生数 / 容量；红色为供需比 ≥ 2 的热门活动')
chart_x, chart_y = 230, 120
top_rows = activity_rows[:15]
max_demand = max(row['applicants'] for row in activity_rows)
row_h = 32
for index, row in enumerate(top_rows):
    y = chart_y + index * row_h
    parts.append(text(chart_x - 12, y + 13, f"{row['activity_id']} {row['activity_name']}", 11, C['text'], 'end'))
    capacity_w = 300 * float(row['capacity']) / max_demand
    demand_w = 300 * float(row['applicants']) / max_demand
    bar(parts, chart_x, y + 2, capacity_w, 10, C['light'], 3)
    bar(parts, chart_x, y + 14, demand_w, 10, C['red'] if float(row['demand_ratio']) >= 2 else C['blue'], 3)
    parts.append(text(chart_x + max(capacity_w, demand_w) + 10, y + 18,
                      f"供需 {row['demand_ratio']}｜容量 {row['capacity']}｜申请 {row['applicants']}", 10, C['muted']))
parts.append(text(chart_x, chart_y + len(top_rows) * row_h + 16,
                  '上排浅色 = 容量；下排 = 去重申请人数', 11, C['muted']))
parts.append(text(48, 650, f"重点：{len(hot_activities)} 个热门活动容量合计 {demand['hot_share']['capacity']}"
                           f"（占总容量 {demand['hot_share']['capacity_ratio_of_all']}%），获得 "
                           f"{demand['hot_share']['applicants_ratio_of_all']}% 的去重申请与 "
                           f"{demand['hot_share']['waitlisted_ratio_of_all']}% 的最终候补。", 11, C['muted']))
svg_close(parts, 'fig2_activity_demand.svg')

# 图 3：候补流转
parts = svg_open()
title_block(parts, '候补流转：进入、转正与观测结束时仍在等待', '候补申请按 application_id 计数；转正 130 条，仍候补 746 条')
chart_x, chart_y, chart_w = 90, 150, 780
rows = [('进入候补队列', len(waitlist_application_ids), C['blue']),
        ('观测期内转正', waitlist['promoted'], C['green']),
        ('观测结束仍候补', waitlist['still_waitlisted_at_observation_end'], C['orange'])]
max_v = max(value for _, value, _ in rows)
for index, (label, value, color) in enumerate(rows):
    y = chart_y + index * 110
    bar(parts, chart_x, y, chart_w * value / max_v, 54, color, 8)
    parts.append(text(chart_x + 16, y + 34, label, 15, '#ffffff', weight='700'))
    parts.append(text(chart_x + chart_w * value / max_v - 16, y + 34, f'{value} 条', 15, '#ffffff', 'end', '700'))
    parts.append(text(chart_x + chart_w * value / max_v + 14, y + 34, f'{ratio(value, len(waitlist_application_ids))}%', 14, C['dark'], weight='700'))
parts.append(text(48, 500, f"转正申请的中位等待时间：{waitlist['promotion_wait_hours']['p50']} 小时；"
                           f"最长 {waitlist['promotion_wait_hours']['max']} 小时。", 12, C['text']))
parts.append(text(48, 524, f"130 次取消均触发 1 次递补，取消到递补转正的中位间隔 {waitlist['cancel_to_promotion_seconds']['median']} 秒。",
                  11, C['muted']))
svg_close(parts, 'fig3_waitlist.svg')

# 图 4：反馈主题
parts = svg_open(width=960, height=620)
title_block(parts, '匿名反馈主题分布（可多标签）', '112 条反馈 / 96 名学生；反馈为非随机样本，不能外推为全体用户比例')
chart_x, chart_y, chart_w = 260, 125, 600
max_v = max(theme['feedback_rows'] for theme in feedback_themes)
colors = [C['red'], C['orange'], C['purple'], C['blue'], C['cyan'], C['green']]
for index, theme in enumerate(feedback_themes):
    y = chart_y + index * 66
    parts.append(text(chart_x - 12, y + 24, theme['theme'], 12, C['text'], 'end'))
    bar(parts, chart_x, y, chart_w * theme['feedback_rows'] / max_v, 34, colors[index % len(colors)], 6)
    parts.append(text(chart_x + chart_w * theme['feedback_rows'] / max_v + 10, y + 23,
                      f"{theme['feedback_rows']} 条（{theme['ratio_of_feedback_rows']}%）", 12, C['dark'], weight='700'))
parts.append(text(48, 575, '编码规则：按关键词命中，一条反馈可同时命中多个主题；完整关键词见 tools/analyze.py。',
                  11, C['muted']))
parts.append(text(48, 598, '说明：反馈只能说明“反馈样本中有人提到”，不能等同于 29.5% 的学生都遇到该问题。',
                  11, C['muted']))
svg_close(parts, 'fig4_feedback_themes.svg')

# 图 5：报名相对开放时间
parts = svg_open()
title_block(parts, '报名请求相对活动开放时间的位置', '0–10 分钟内的 apply 请求占 23.9%；0–30 分钟占 40.2%')
chart_x, chart_y, chart_w, chart_h = 90, 130, 780, 330
bins = list(range(0, 181, 10))
counts = []
for start in bins[:-1]:
    counts.append(sum(1 for delta, row in offsets if row['action'] == 'apply' and start <= delta < start + 10))
max_v = max(counts) if counts else 1
bar_w = chart_w / len(counts)
for index, value in enumerate(counts):
    height = chart_h * value / max_v
    bar(parts, chart_x + index * bar_w + 3, chart_y + chart_h - height, bar_w - 6, height,
        C['orange'] if index < 1 else C['blue'], 3)
    if value:
        parts.append(text(chart_x + index * bar_w + bar_w / 2, chart_y + chart_h - height - 6, str(value),
                          10, C['dark'] if index < 3 else C['muted'], 'middle'))
for tick in range(0, 5):
    y = chart_y + chart_h - chart_h * tick / 4
    axis_line(parts, chart_x, y, chart_x + chart_w, y)
for index in range(0, len(bins) - 1, 2):
    parts.append(text(chart_x + index * bar_w + bar_w / 2, chart_y + chart_h + 22, f'{bins[index]}m', 10, C['muted'], 'middle'))
parts.append(text(48, 520, '口径：以 activity.registration_open 为起点，按 apply 请求的 (request_ts - registration_open) 分桶；'
                           '所有请求均在开放后提交。', 11, C['muted']))
parts.append(text(48, 542, f'高峰窗口（0–10 分钟）P95 = {registration["peak_window"]["latency_ms"]["p95"]} ms，'
                           f'其余时段 P95 = {registration["peak_window"]["other_latency_ms"]["p95"]} ms。', 11, C['muted']))
svg_close(parts, 'fig5_registration_timing.svg')

# 图 6：响应耗时
parts = svg_open()
title_block(parts, '报名接口响应耗时（全量请求）',
            f'P95 = {registration["latency_ms_all"]["p95"]} ms；高峰窗口 0–10 分钟 P95 = '
            f'{registration["peak_window"]["latency_ms"]["p95"]} ms，其余时段 '
            f'{registration["peak_window"]["other_latency_ms"]["p95"]} ms')
chart_x, chart_y, chart_w, chart_h = 100, 130, 760, 330
groups = [('全部请求', registration['latency_ms_all']),
          ('开放后 10 分钟', registration['peak_window']['latency_ms']),
          ('其余时段', registration['peak_window']['other_latency_ms'])]
metrics = [('p50', C['blue']), ('p95', C['orange']), ('p99', C['red'])]
max_v = max(stat['p99'] for _, stat in groups)
bar_group_w = chart_w / len(groups)
bar_w = bar_group_w / 4
for group_index, (label, stat) in enumerate(groups):
    base_x = chart_x + group_index * bar_group_w + bar_w * 0.4
    for metric_index, (metric, color) in enumerate(metrics):
        value = stat[metric]
        height = chart_h * value / max_v
        x = base_x + metric_index * bar_w
        bar(parts, x, chart_y + chart_h - height, bar_w * 0.85, height, color, 4)
        parts.append(text(x + bar_w * 0.42, chart_y + chart_h - height - 7, f'{value}', 11, C['dark'], 'middle', '700'))
    parts.append(text(chart_x + group_index * bar_group_w + bar_group_w / 2, chart_y + chart_h + 26, label, 12, C['text'], 'middle'))
for metric_index, (metric, color) in enumerate(metrics):
    parts.append(f'<rect x="{chart_x + metric_index * 120}" y="{chart_y - 28}" width="12" height="12" rx="2" fill="{color}"/>')
    parts.append(text(chart_x + metric_index * 120 + 18, chart_y - 17, metric.upper(), 12, C['text']))
parts.append(text(48, 520, '口径：registration_log.latency_ms 全量 2878 条；系统日志中的 SLOW_REQUEST（250 条）只用于定位活动与时段。',
                  11, C['muted']))
svg_close(parts, 'fig6_latency.svg')

# 图 7：设备分布
parts = svg_open()
title_block(parts, '访问设备与移动端使用', '全部行为事件中移动端 70.9%；报名页 74.9%、状态页 78.2%')
total = len(behaviors_clean)
chart_x, chart_y, chart_w = 90, 130, 780
bar(parts, chart_x, chart_y, chart_w, 50, C['light'], 8)
current = 0.0
for key, color, label in [('mobile', C['red'], '移动端'), ('desktop', C['blue'], '桌面端'),
                          ('tablet', C['orange'], '平板'), ('', C['gray'], '未记录')]:
    value = device_counts.get(key, 0)
    width = chart_w * value / total
    bar(parts, chart_x + current, chart_y, width, 50, color, 0)
    if width > 40:
        parts.append(text(chart_x + current + width / 2, chart_y + 31, f'{label} {ratio(value, total)}%',
                          13, '#ffffff', 'middle', '700'))
    current += width
parts.append(text(48, 240, '各页面设备构成（占该页面访问次数）', 16, C['dark'], weight='700'))
for index, (key, label) in enumerate([('activity_list', '列表页'), ('activity_detail', '详情页'),
                                      ('registration', '报名页'), ('registration_status', '状态页')]):
    page_total = page_counts[key]
    mobile = sum(1 for row in behaviors_clean if row['page'] == key and row['device'] == 'mobile')
    parts.append(text(chart_x, 290 + index * 58, label, 12, C['text']))
    bar(parts, chart_x + 100, 276 + index * 58, chart_w - 100, 26, C['light'], 4)
    bar(parts, chart_x + 100, 276 + index * 58, (chart_w - 100) * mobile / page_total, 26, C['red'], 4)
    parts.append(text(chart_x + 110, 294 + index * 58, f"移动端 {mobile}/{page_total}（{ratio(mobile, page_total)}%）",
                      11, '#ffffff' if mobile / page_total > 0.3 else C['dark'], weight='700'))
parts.append(text(48, 540, '数据来源：user_behavior.csv 去重后的 10999 条事件、1416 个会话；移动端占比高，'
                           '但 V2.0 在窄屏下隐藏侧边栏且未提供替代导航。', 11, C['muted']))
svg_close(parts, 'fig7_device.svg')

# 图 8：会话行为漏斗
parts = svg_open()
title_block(parts, '会话行为漏斗（按会话中是否出现该页面）', '1416 个会话；行为表不保证完整路径，因此不解释为严格步骤转化')
chart_x, chart_y, chart_w = 260, 140, 620
rows = [('列表 + 详情', behavior['funnel']['sessions_with_list_and_detail'],
         behavior['funnel']['ratio_list_and_detail'], C['blue']),
        ('进入报名页', behavior['funnel']['sessions_with_registration_page'],
         behavior['funnel']['ratio_registration_page'], C['green']),
        ('查看报名状态', behavior['funnel']['sessions_with_status_page'],
         behavior['funnel']['ratio_status_page'], C['orange'])]
max_v = sessions
for index, (label, value, share, color) in enumerate(rows):
    y = chart_y + index * 90
    parts.append(text(chart_x - 16, y + 28, label, 14, C['text'], 'end'))
    bar(parts, chart_x, y, chart_w * value / max_v, 42, color, 8)
    parts.append(text(chart_x + 14, y + 27, f'{value} 个会话', 13, '#ffffff', weight='700'))
    parts.append(text(chart_x + chart_w * value / max_v + 12, y + 27, f'{share}%', 14, C['dark'], weight='700'))
parts.append(text(48, 470, f"详情页访问 {page_counts['activity_detail']} 次 / 列表页访问 {page_counts['activity_list']} 次 = "
                           f"{behavior['funnel']['detail_views_per_list_view']}；每名学生中位数：列表 "
                           f"{behavior['per_student_median']['list_views']} 次、详情 {behavior['per_student_median']['detail_views']} 次。",
                  11, C['muted']))
parts.append(text(48, 494, '解释：学生需要反复打开详情才能判断活动是否合适，与反馈中“一条条打开看/标题差不多”一致。',
                  11, C['muted']))
svg_close(parts, 'fig8_behavior_funnel.svg')

# 图 9：最终状态与冲突
parts = svg_open()
title_block(parts, '最终报名状态与时间重叠', '按时间回放 registration_log + waitlist_log；冲突口径为开始时间相差 < 2 小时')
chart_x, chart_y, chart_w = 90, 140, 360
max_v = max(final_counts.get('confirmed', 0), final_counts.get('waitlisted', 0))
for index, (label, value, color) in enumerate([('正式报名', final_counts.get('confirmed', 0), C['green']),
                                               ('候补中', final_counts.get('waitlisted', 0), C['blue'])]):
    y = chart_y + index * 90
    parts.append(text(chart_x - 12, y + 28, label, 13, C['text'], 'end'))
    bar(parts, chart_x, y, chart_w * value / max_v, 44, color, 8)
    parts.append(text(chart_x + 14, y + 28, f'{value} 人', 13, '#ffffff', weight='700'))
parts.append(text(560, 170, '已报名 ≥ 2 个活动的学生', 13, C['muted']))
parts.append(text(560, 205, f'{len(multi_confirmed)} 人', 30, C['dark'], weight='700'))
parts.append(text(560, 245, '其中存在时间重叠', 13, C['muted']))
parts.append(text(560, 280, f'{len(conflict_students)} 人（{conflict["conflict_ratio_of_multi_confirmed"]}%）', 24, C['red'], weight='700'))
parts.append(text(560, 322, f'冲突活动对：{len(conflict_pairs)} 对', 13, C['text']))
parts.append(text(48, 470, '限制：活动表没有结束时间、课表与签到数据，无法计算真实冲突时长、到场率或满意度。',
                  11, C['muted']))
svg_close(parts, 'fig9_final_state_conflict.svg')

print('图表已写入', FIG)
