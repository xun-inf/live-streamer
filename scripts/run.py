#!/usr/bin/env python3
"""bigolive-streamer 启动脚本：构建（可 --skip-build 跳过）后拉起整套应用。

用法：
    python scripts/run.py [--config Debug] [--skip-build] [--dev]

默认跑 build/out/<config>/ 里那一整套（零参数，和安装后完全一样）；
--dev 则用仓库里的 electron 源码 + 仓库 assets 起，改前端时不用等打包。

构建逻辑全在 scripts/build.py；子进程回收由 bigolive-streamer.exe 的 Job Object 负责。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build import (  # noqa: E402  （得先补 sys.path 才能导入同目录的 build.py）
    ASSETS_DIR,
    ELECTRON_DIR,
    LOG_DIR,
    build_all,
    child_env,
    electron_binary,
    executable_name,
    log,
    output_dir,
    target_binary,
)


def run_out(config: str) -> int:
    """跑产物目录：不带任何参数，走 bigolive-streamer.exe 自己的默认路径解析。"""
    host = output_dir(config) / executable_name("bigolive-streamer")
    if not host.exists():
        raise SystemExit(
            "[run] 找不到 {0}\n先执行 python scripts/build.py（或去掉 --skip-build）".format(host)
        )

    log("启动产物目录: " + str(host))
    log("  logs = " + str(host.parent / "logs"))
    log("关掉 Electron 窗口即可退出全部进程")

    result = subprocess.run([str(host)], env=child_env())
    log("bigolive-streamer.exe 退出，code={0}".format(result.returncode))
    return result.returncode


def run_dev(config: str) -> int:
    """开发模式：直接用构建产物 + 仓库里的 electron 源码，省掉打包这一步。"""
    host = target_binary("bigolive-streamer", config)
    engine = target_binary("media-engine", config)
    ui_exe = electron_binary()

    missing = [path for path in (host, engine, ui_exe) if not path.exists()]
    if missing:
        raise SystemExit(
            "[run] 缺少可执行文件：\n  "
            + "\n  ".join(str(path) for path in missing)
            + "\n先执行 python scripts/build.py"
        )

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    pipe_name = "\\\\.\\pipe\\bigolive-streamer-dev-{0}".format(os.getpid())
    host_args = [
        str(host),
        "--engine=" + str(engine),
        "--ui=" + str(ui_exe),
        "--ui-app=" + str(ELECTRON_DIR),
        "--assets=" + str(ASSETS_DIR),
        "--pipe-name=" + pipe_name,
        "--log-dir=" + str(LOG_DIR),
    ]

    log("启动开发模式（electron 源码 + 仓库 assets）")
    log("  host     = " + str(host))
    log("  engine   = " + str(engine))
    log("  ui       = " + str(ui_exe))
    log("  pipe     = " + pipe_name)
    log("  logs     = " + str(LOG_DIR))
    log("关掉 Electron 窗口即可退出全部进程")

    result = subprocess.run(host_args, env=child_env())
    log("bigolive-streamer.exe 退出，code={0}".format(result.returncode))
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="bigolive-streamer 启动脚本")
    parser.add_argument("--config", default="Debug", help="Debug / Release")
    parser.add_argument(
        "--skip-build", action="store_true", help="跳过构建，直接用现有产物启动"
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="开发模式：用仓库里的 electron 源码启动，不做 stage",
    )
    args = parser.parse_args()

    if not args.skip_build:
        build_all(args.config, stage_output=not args.dev)
    return run_dev(args.config) if args.dev else run_out(args.config)


if __name__ == "__main__":
    sys.exit(main())