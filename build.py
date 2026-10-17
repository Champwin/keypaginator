# -*- coding: utf-8 -*-
"""打包成 xpi（本质是 zip）

Firefox MV3 强制要求 manifest 里带 add-on ID，因此本地版与 AMO 提交版内容完全一致，
上传 AMO 任选一个即可。

输出：
  1) ./keypaginator.xpi               -> 插件目录
  2) ../keypaginator.xpi              -> 工作区根目录备份
  3) dist/keypaginator-<版本>.xpi      -> 带版本号归档

★ 回退保障（2026-10-17 加入，务必保留这两段逻辑）
  - 打包前自动调用 ../restore.py 存快照，每次打包都有独立可回退点。
  - dist/ 与根目录的同名归档不再被静默覆盖：旧件自动改名为 .bak-时间戳。
    （此前版本号未升时会把历史归档直接冲掉，回退链断过一次——别删。）

★ 整目录回退请用上级目录的 restore.bat / restore.py，不要手改本文件。
  回退到整合前状态时，本文件会被还原成不含 snapshot 逻辑的旧版，属正常。

用法：python build.py
"""
import os, json, zipfile, sys, subprocess, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

INCLUDE = [
    'manifest.json', 'content.js', 'background.js',
    'popup.html', 'popup.js', 'options.html', 'options.js',
    'contrast.js', 'guard.css',
    'icons/icon48.png', 'icons/icon96.png',
    'README.md',
]

with open(os.path.join(HERE, 'manifest.json'), encoding='utf-8') as f:
    manifest = json.load(f)
VERSION = manifest.get('version', '1.0.0')

# ----------------- 版本号复用检查（2026-10-17 加，务必保留）-----------------
# 历史事故：修复 innerHTML 后又用同一个版本号 1.0.3 反复打包多次，
#   而 AMO 上上传的是修复前的那版。结果同一个 "1.0.3" 名下存在两份
#   内容完全不同的包 —— 人无法判断哪个是对的，也无法重新启用已上传的版本。
# 现在规则：**版本号一旦用过就不可复用**。若本次源码内容与 dist 下
#   同版本号的既有包不同（仅 manifest 版本号以外有差异），直接报错要求递增版本号。
import hashlib
import zipfile as _zipfile


def _src_digest():
    """当前源码内容指纹（忽略 manifest 的 version 字段与注释行）。"""
    h = _hashlib.sha256()
    for name in ['content.js', 'contrast.js', 'guard.css', 'background.js',
                 'popup.html', 'popup.js', 'options.html', 'options.js']:
        p = os.path.join(HERE, name)
        if os.path.exists(p):
            with open(p, 'rb') as fh:
                h.update(fh.read())
    return h.hexdigest()


import hashlib as _hashlib
_cur_digest = _src_digest()
_dist_dir = os.path.join(HERE, 'dist')
_same_ver_file = None
if os.path.isdir(_dist_dir):
    for _f in os.listdir(_dist_dir):
        if _f == 'keypaginator-%s.xpi' % VERSION:
            _same_ver_file = os.path.join(_dist_dir, _f)
            break

if _same_ver_file:
    try:
        with _zipfile.ZipFile(_same_ver_file) as _z:
            _hh = _hashlib.sha256()
            for _n in ['content.js', 'contrast.js', 'guard.css', 'background.js',
                       'popup.html', 'popup.js', 'options.html', 'options.js']:
                if _n in _z.namelist():
                    _hh.update(_z.read(_n))
            _old_digest = _hh.hexdigest()
        if _old_digest != _cur_digest:
            print('!! 自检未通过：')
            print('   - 版本号 %s 已被用过，且内容与既有包不同（同名不同内容）。' % VERSION)
            print('     既有包: %s' % os.path.basename(_same_ver_file))
            print('     AMO 上已存在该版本时，重新启用会拿到**旧代码**，无法修复线上问题。')
            print('     请把 manifest.json 的 version 递增（如 %s.1 → 下个可用版本）后重试。'
                  % VERSION)
            raise SystemExit(1)
        print('提示：版本号 %s 与既有包内容一致（未改动，可重新打包）。' % VERSION)
    except SystemExit:
        raise
    except Exception as e:
        print('  [提醒] 版本复用检查跳过：%s' % e)

# ----------------- 提交前自检（对应 addons-linter 历史报错）-----------------
# 规则来源：MDN browser_specific_settings
#   - MV3 必须有 gecko.id
#   - data_collection_permissions 必须是**对象**：{"required": ["none"]}
#   - 该 key 桌面 Firefox 140+ / Android 142+ 才支持，strict_min_version 不能低于它
bss = manifest.get('browser_specific_settings', {})
gecko = bss.get('gecko', {})
android = bss.get('gecko_android', {})
DCP_MIN_DESKTOP = 140
DCP_MIN_ANDROID = 142

problems = []


def major(ver):
    try:
        return int(str(ver).split('.')[0])
    except Exception:
        return 0


# 1) MV3 扩展 ID
eid = gecko.get('id')
if not eid:
    problems.append('缺少 browser_specific_settings.gecko.id（MV3 必需）')

# 1b) ID 是否仍是"通用占位符"或"新建 UUID"——这两种情况在 AMO 上传时会被拒
#     AMO 报错原文：您的 manifest.json ({...}) 中的附加组件 ID 与您的附加组件
#     在 AMO (xxx) 上的 ID 不匹配。
#     原因：同一个 add-on 条目下，manifest 的 ID 必须与建条目时用的 ID 完全一致。
#     换 ID 只能新建条目，不能在旧条目里传。
#
#     ★ AMO_ID 可用环境变量覆盖（发布公开仓库的副本请用通用值，避免泄露自己的 ID）：
#         Windows CMD   :  set KEYPAGINATOR_AMO_ID=your-id@your-domain  && python build.py
#         PowerShell    :  $env:KEYPAGINATOR_AMO_ID='your-id@your-domain'; python build.py
#         Bash          :  KEYPAGINATOR_AMO_ID=your-id@your-domain python build.py
#       留空则跳过该检查（适合发布给他人使用）。
AMO_ID = os.environ.get('KEYPAGINATOR_AMO_ID', '').strip()
if AMO_ID and eid == 'keypaginator@example.com':
    problems.append(
        '当前 gecko.id 是通用占位符 keypaginator@example.com。\n'
        '       上传到 AMO 会被拒（ID 与你已有的 add-on 条目 %s 不匹配）。\n'
        '       请把 id 改成 %s，或在 AMO 首页用「提交新附加组件」另建条目。'
        % (AMO_ID, AMO_ID))
if AMO_ID and eid and eid.startswith('{'):
    problems.append(
        '当前 gecko.id 是新生成的 UUID（%s）。\n'
        '       AMO 里已存在的条目用的是 %s，ID 不一致会被直接拒收。\n'
        '       二选一：① 改回 %s 在旧条目下点「上传新版本」；\n'
        '               ② 回 AMO 首页用「提交新附加组件」以该 UUID 新建条目。'
        % (eid, AMO_ID, AMO_ID))
if eid and eid.startswith('{') and not AMO_ID:
    print('提示：检测到新 UUID 作为扩展 ID。'
          '若你在 AMO 已有条目，请设置环境变量 KEYPAGINATOR_AMO_ID 为该条目的 ID 以启用校验。')

# 2) data_collection_permissions 必须是对象，且 required 为数组
dcp = gecko.get('data_collection_permissions')
if dcp is None:
    problems.append('缺少 gecko.data_collection_permissions（AMO 自 2025-11-03 起新扩展必填）')
elif not isinstance(dcp, dict):
    problems.append('data_collection_permissions 必须是对象，正确写法：{"required": ["none"]}，不能写成数组')
else:
    req = dcp.get('required')
    if not isinstance(req, list) or not req:
        problems.append('data_collection_permissions.required 必须是非空数组，不收集数据时写 ["none"]')
    elif req != ['none'] and 'none' in req and len(req) > 1:
        problems.append('required 里的 "none" 不能与其它数据类型同时出现')

# 3) 版本号必须够新，否则 linter 报 "Manifest key not supported by the specified minimum Firefox version"
minv = major(gecko.get('strict_min_version', 0))
if dcp is not None and minv < DCP_MIN_DESKTOP:
    problems.append('gecko.strict_min_version 需 >= %d.0（当前 %s），否则 data_collection_permissions 不被该最低版本支持'
                    % (DCP_MIN_DESKTOP, gecko.get('strict_min_version')))
amin = major(android.get('strict_min_version', 0)) if android else minv
if dcp is not None and amin < DCP_MIN_ANDROID:
    problems.append('（Android）strict_min_version 需 >= %d.0（当前 %s）'
                    % (DCP_MIN_ANDROID, android.get('strict_min_version') or gecko.get('strict_min_version')))

# 4) 打包文件是否齐全
for n in INCLUDE:
    if not os.path.exists(os.path.join(HERE, n)):
        problems.append('缺少文件: ' + n)

# 5) manifest 里声明的 content_scripts / background 引用的文件必须真实存在
#    （这类遗漏最隐蔽：扩展能装上，但功能静默失效）


def collect_refs(node, out):
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ('js', 'css') and isinstance(v, list):
                out.extend(v)
            elif k == 'service_worker' and isinstance(v, str):
                out.append(v)
            elif k == 'scripts' and isinstance(v, list):
                out.extend(v)
            else:
                collect_refs(v, out)
    elif isinstance(node, list):
        for x in node:
            collect_refs(x, out)


refs = []
collect_refs(manifest.get('content_scripts', []), refs)
collect_refs(manifest.get('background', {}), refs)
for k in ('action', 'options_ui'):
    node = manifest.get(k, {})
    if isinstance(node, dict):
        for fk in ('default_popup', 'page'):
            if node.get(fk):
                refs.append(node[fk])

for r in sorted(set(refs)):
    if not os.path.exists(os.path.join(HERE, r)):
        problems.append('manifest 引用了不存在的文件: %s（该功能会静默失效）' % r)

# 6) AMO linter 高危模式扫描
#    addons-linter 会在上传时拒绝或警告以下写法，本项目要求一律不用：
#      - Unsafe assignment to innerHTML / outerHTML
#      - insertAdjacentHTML
#      - document.write
#      - eval / new Function
#      - setTimeout/setInterval 传字符串
#    正确写法：createElement + textContent / .value / appendChild。
#    （历史教训：options.js 曾残留一处 innerHTML 拼接，2026-10-17 被 AMO 拦下。）
import re

LINTER_PATTERNS = [
    (r'\.innerHTML\s*=', 'Unsafe assignment to innerHTML', '改用 createElement + textContent'),
    (r'\.outerHTML\s*=', 'Unsafe assignment to outerHTML', '改用 createElement + textContent'),
    (r'\.insertAdjacentHTML\s*\(', 'insertAdjacentHTML', '改用 appendChild / createElement'),
    (r'document\.write\s*\(', 'document.write', '改用 DOM API'),
    (r'\beval\s*\(', 'eval', '改用显式逻辑'),
    (r'new\s+Function\s*\(', 'new Function', '改用显式逻辑'),
    (r'\bsetTimeout\s*\(\s*[\'"]', 'setTimeout 传字符串', '改用函数体'),
    (r'\bsetInterval\s*\(\s*[\'"]', 'setInterval 传字符串', '改用函数体'),
]

for src in INCLUDE:
    if not src.endswith(('.js', '.html')):
        continue
    p = os.path.join(HERE, src)
    try:
        with open(p, encoding='utf-8') as fh:
            lines = fh.readlines()
    except (OSError, UnicodeDecodeError):
        continue
    for i, line in enumerate(lines, 1):
        code = re.sub(r'//.*$', '', line)
        code = re.sub(r'/\*.*?\*/', '', code)
        for pat, label, fix in LINTER_PATTERNS:
            if re.search(pat, code):
                # 注释里提到这些词不算问题（如注释写着"不使用 innerHTML"）
                problems.append('%s:%d 使用了 %s —— %s' % (src, i, label, fix))

if problems:
    print('!! 自检未通过：')
    for p in problems:
        print('   -', p)
    raise SystemExit(1)
print('自检通过：ID = %s | dcp = %s | min(桌面/Android) = %s/%s | linter 高危模式 0 处'
      % (eid, dcp, gecko.get('strict_min_version'), android.get('strict_min_version', gecko.get('strict_min_version'))))


def build(out_path, allow_overwrite=False):
    d = os.path.dirname(out_path)
    if d:
        os.makedirs(d, exist_ok=True)
    # 防覆盖：旧归档改名保留，绝不静默冲掉历史回退点
    if os.path.exists(out_path) and not allow_overwrite:
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        keep = out_path + '.bak-' + stamp
        os.replace(out_path, keep)
        print('  [防覆盖] 旧归档已改名为 %s（历史回退点保留）' % os.path.basename(keep))
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in INCLUDE:
            z.write(os.path.join(HERE, name), name)
    print('wrote %s (%d bytes)' % (out_path, os.path.getsize(out_path)))


# ----------------- 打包前自动留回退快照 -----------------
# 每次打包都对应一个独立可回退点，防止"改完才发现坏了却退不回去"。
restore = os.path.join(ROOT, 'restore.py')
if os.path.exists(restore):
    try:
        subprocess.run([sys.executable, restore, 'snapshot', '打包前自动快照 v%s' % VERSION],
                       cwd=ROOT, check=False)
    except Exception as e:
        print('  [提醒] 自动快照跳过：%s（不影响打包）' % e)

build(os.path.join(HERE, 'keypaginator.xpi'), allow_overwrite=True)
build(os.path.join(ROOT, 'keypaginator.xpi'), allow_overwrite=True)
build(os.path.join(HERE, 'dist', 'keypaginator-%s.xpi' % VERSION))

# ----------------- 打包后跑官方 addons-linter -----------------
# 与 AMO 服务端同源，本地过了再上传，避免"上传才被驳回"。
# 未安装 addons-linter 时自动跳过，不阻断打包。
lint_script = os.path.join(HERE, 'lint_amo.py')
if os.path.exists(lint_script):
    print('\n--- addons-linter 校验（AMO 同源）---')
    try:
        r = subprocess.run([sys.executable, lint_script],
                           cwd=HERE, check=False)
        if r.returncode != 0:
            print('  [警告] addons-linter 报出问题，请检查上面的明细后再上传 AMO')
    except Exception as e:
        print('  [提醒] linter 校验跳过：%s（不影响已生成的包）' % e)
