# -*- coding: utf-8 -*-
"""可选：把官方 addons-linter 校验接进打包流程。

addons-linter 与 AMO 服务端同源，本地过了再上传，可避免"上传才被驳回"。
未安装时自动跳过，不阻断打包。

用法：
    python lint_amo.py                # 校验 dist 下最新的 xpi
    python lint_amo.py <xpi 路径>     # 校验指定包

安装（任选其一）：
    npm install -g addons-linter
    或把 node 与 addons-linter 的位置填到下面两个环境变量：
        KP_NODE         指向 node 可执行文件
        KP_ADDONS_LINTER 指向 addons-linter 的 bin 脚本
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ADDONS_LINTER_BIN = os.environ.get('KP_ADDONS_LINTER', '').strip()


def find_node():
    """按优先级找 node：环境变量 -> PATH -> 常见安装位置。"""
    env = os.environ.get('KP_NODE', '').strip()
    if env and os.path.exists(env):
        return env
    found = shutil.which('node')
    if found:
        return found
    for base in (os.environ.get('ProgramFiles', r'C:\Program Files'),
                 os.environ.get('LOCALAPPDATA', ''),
                 os.path.expanduser('~')):
        if not base:
            continue
        for rel in (('nodejs', 'node.exe'), ('node', 'node.exe'),
                    ('nvm4w', 'nodejs', 'node.exe')):
            p = os.path.join(base, *rel)
            if os.path.isfile(p):
                return p
    return None


def find_linter():
    if ADDONS_LINTER_BIN and os.path.exists(ADDONS_LINTER_BIN):
        return ADDONS_LINTER_BIN
    # npx 可执行时交由 npx 解析包
    npx = shutil.which('npx')
    return ('npx', npx) if npx else None


def pick_xpi():
    if len(sys.argv) > 1:
        return sys.argv[1]
    dist = os.path.join(HERE, 'dist')
    if not os.path.isdir(dist):
        return None
    xp = [f for f in os.listdir(dist) if f.endswith('.xpi') and '.bak-' not in f]
    if not xp:
        return None
    xp.sort(key=lambda f: os.path.getmtime(os.path.join(dist, f)))
    return os.path.join(dist, xp[-1])


def main():
    node = find_node()
    linter = find_linter()
    if not node:
        print('[跳过] 未找到 node，无法运行 addons-linter')
        return 0
    if not linter:
        print('[跳过] 未找到 addons-linter。安装：npm install -g addons-linter')
        return 0

    xpi = pick_xpi()
    if not xpi:
        print('[跳过] dist 下没有可校验的 xpi，请先运行 build.py')
        return 0

    print('addons-linter 校验：%s' % os.path.relpath(xpi, HERE))
    if isinstance(linter, tuple):
        cmd = [linter[1], '--yes', 'addons-linter', '--output', 'json', xpi]
    else:
        cmd = [node, linter, '--output', 'json', xpi]

    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=300)
    except subprocess.TimeoutExpired:
        print('  [跳过] 校验超时')
        return 0
    except OSError as e:
        print('  [跳过] 无法启动校验：%s' % e)
        return 0

    import json
    try:
        d = json.loads(p.stdout)
    except (ValueError, TypeError):
        print(p.stdout[:600] or p.stderr[:600])
        return 0   # 输出非 JSON（如 npx 提示信息）时不阻断

    e, w, n = len(d.get('errors', [])), len(d.get('warnings', [])), len(d.get('notices', []))
    print('  errors %d / warnings %d / notices %d' % (e, w, n))
    for kind in ('errors', 'warnings', 'notices'):
        for m in d.get(kind, []):
            loc = ('  @ %s:%s' % (m.get('file'), m.get('line'))) if m.get('file') else ''
            print('   [%s] %s%s' % (m.get('code'), m.get('message'), loc))

    if e == 0:
        print('  校验通过，可提交 AMO')
        return 0
    print('  有错误，暂不可提交')
    return 1


if __name__ == '__main__':
    sys.exit(main())