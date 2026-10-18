# -*- coding: utf-8 -*-
"""把 analysis/figures/*.svg 渲染为同名 PNG。

优先使用本机 Edge/Chrome 的 headless 模式，避免依赖 matplotlib 或 cairosvg。
用法：python tools/render_figures.py
"""
from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIG = ROOT / 'analysis' / 'figures'

CANDIDATES = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]


def find_browser() -> str | None:
    for path in CANDIDATES:
        if os.path.exists(path):
            return path
    return shutil.which('msedge') or shutil.which('chrome') or shutil.which('chromium')


def svg_size(path: Path) -> tuple[int, int]:
    head = path.read_text(encoding='utf-8')[:500]
    width = int(re.search(r'width="(\d+)"', head).group(1))
    height = int(re.search(r'height="(\d+)"', head).group(1))
    return width, height


def main() -> int:
    browser = find_browser()
    if not browser:
        print('未找到 Edge/Chrome，可跳过 PNG 渲染；SVG 图表已生成。')
        return 0
    svgs = sorted(FIG.glob('*.svg'))
    if not svgs:
        print('没有找到 SVG 图表，请先运行 python tools/analyze.py')
        return 1
    for svg in svgs:
        width, height = svg_size(svg)
        png = svg.with_suffix('.png')
        command = [
            browser,
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            '--no-default-browser-check',
            f'--window-size={width},{height}',
            f'--screenshot={png}',
            svg.as_uri(),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        # Edge 会向 stderr 打印无关警告，以 PNG 是否生成作为成功判据
        if not png.exists():
            print(f'渲染失败：{svg.name}\n{result.stderr[-800:]}')
            return 1
        print(f'  ✔ {png.name} ({width}x{height})')
    print(f'完成：{len(svgs)} 张图 -> {FIG}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
