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

if problems:
    print('!! 自检未通过：')
    for p in problems:
        print('   -', p)
    raise SystemExit(1)
print('自检通过：ID = %s | dcp = %s | min(桌面/Android) = %s/%s'
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
