#!/usr/bin/env python3
"""bigolive-streamer 构建脚本：原生侧（C++/CMake）+ Electron（tsc）。

用法：
    python scripts/build.py [--config Debug]

scripts/run.py 复用这里的函数（构建完再启动），两边不会各写一份。
Windows 包装：仓库根目录的 build-win-x84_64.bat。
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE_DIR = ROOT / "core"
BUILD_DIR = ROOT / "build" / "core"
ELECTRON_DIR = ROOT / "electron"
ASSETS_DIR = ROOT / "assets"
ASSETS_BIN_DIR = ASSETS_DIR / "bin"
OUT_DIR = ROOT / "build" / "out"

# UI 进程就用 Electron 运行时本体（electron.exe），不改名：文件名和进程名对得上，省得解释
LOG_DIR = ROOT / "build" / "logs"

IS_WINDOWS = os.name == "nt"


def configure_streams() -> None:
    """控制台跟随系统代码页；管道/重定向统一 UTF-8，免得和父进程解码方式打架。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream.isatty():
                stream.reconfigure(errors="replace")
            else:
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


configure_streams()


def log(message: str) -> None:
    print("[build] " + message, flush=True)


def child_env() -> dict:
    env = os.environ.copy()
    # 有这个变量时 electron.exe 会退化成普通 Node（子进程会继承），必须清掉
    env.pop("ELECTRON_RUN_AS_NODE", None)
    return env


def run_command(command, cwd=None) -> None:
    log(" ".join(str(part) for part in command))
    result = subprocess.run(
        [str(part) for part in command],
        cwd=str(cwd) if cwd else None,
        env=child_env(),
    )
    if result.returncode != 0:
        raise SystemExit(
            "[build] 上一条命令失败，退出码 {0}".format(result.returncode)
        )


def executable_name(name: str) -> str:
    return name + ".exe" if IS_WINDOWS else name


def build_native(config: str) -> None:
    configure = ["cmake", "-S", CORE_DIR, "-B", BUILD_DIR]
    if IS_WINDOWS:
        configure += ["-A", "x64"]
    run_command(configure)
    run_command(["cmake", "--build", BUILD_DIR, "--config", config, "--parallel"])
    log("原生侧构建完成（config {0}）".format(config))


def find_npm() -> str:
    npm = shutil.which("npm.cmd") if IS_WINDOWS else None
    npm = npm or shutil.which("npm")
    if npm is None:
        raise SystemExit("[build] PATH 里找不到 npm")
    return npm


def electron_binary() -> Path:
    folder = ELECTRON_DIR / "node_modules" / "electron" / "dist"
    return folder / executable_name("electron")


def prepare_electron() -> None:
    npm = find_npm()
    if not (ELECTRON_DIR / "node_modules").exists():
        run_command([npm, "install"], cwd=ELECTRON_DIR)

    binary = electron_binary()
    if not binary.exists():
        # npm 有时不跑 electron 的 postinstall，二进制缺失时补一次
        installer = ELECTRON_DIR / "node_modules" / "electron" / "install.js"
        node = shutil.which("node")
        if node is None or not installer.exists():
            raise SystemExit("[build] electron 未安装：先在 electron/ 执行 npm install")
        run_command([node, installer], cwd=ELECTRON_DIR)

    run_command([npm, "run", "build"], cwd=ELECTRON_DIR)


def target_binary(name: str, config: str) -> Path:
    """CMake 产物统一在 build/out/<config>（单配置生成器没有 config 这一层）。"""
    folder = OUT_DIR
    candidates = [
        folder / config / executable_name(name),
        folder / executable_name(name),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def output_dir(config: str) -> Path:
    """产物目录 = CMake 的输出目录，也是最终的可分发目录：build/out/<config>。

    单配置生成器（Ninja）没有 config 这一层，直接落在 build/out。
    """
    return target_binary("bigolive-streamer", config).parent



def copy_tree(source: Path, target: Path, exclude=()) -> None:
    """Windows 用 robocopy：内容没变就直接跳过，不用每次重拷 250MB 的 Electron 运行时。"""
    if not source.exists():
        raise SystemExit("[build] 源目录不存在: {0}".format(source))
    if IS_WINDOWS:
        command = [
            "robocopy",
            source,
            target,
            "/E",
            "/R:1",
            "/W:1",
            "/NFL",
            "/NDL",
            "/NJH",
            "/NJS",
            "/NP",
        ]
        if exclude:
            command += ["/XF"] + list(exclude)
        result = subprocess.run([str(part) for part in command], env=child_env())
        # robocopy 退出码 < 8 都算成功（1 = 有文件被复制）
        if result.returncode >= 8:
            raise SystemExit(
                "[build] robocopy 失败，退出码 {0}".format(result.returncode)
            )
        return
    shutil.copytree(source, target, dirs_exist_ok=True)


def stage(config: str) -> Path:
    """把 Electron 运行时 + Electron 应用 + assets/bin 里的东西铺进 CMake 的输出目录。

    产物目录（build/out/<config>）就是可分发目录，不再另建一份 dist：
        build/out/<config>/
        ├── bigolive-streamer.exe     # CMake 直接构建在这里
        ├── media-engine.exe
        ├── electron.exe + Chromium 运行时文件   # 摊在根下，不套子目录
        ├── <assets/bin 里的东西>     # 直接摊在根下（ffmpeg 之类），不留 bin/ 这一层
        ├── resources/               # Electron 自己的目录，只放它自己的东西
        │   ├── app/                 # 我们的 Electron 应用（main.js 按 ../../src 找 preload）
        │   └── default_app.asar     # Electron 自带，不用管
        └── logs/                    # 首次运行时自动创建
    """
    target = output_dir(config)
    for name in ("bigolive-streamer", "media-engine"):
        binary = target_binary(name, config)
        if not binary.exists():
            raise SystemExit("[build] 缺少构建产物: {0}".format(binary))
    target.mkdir(parents=True, exist_ok=True)

    runtime = ELECTRON_DIR / "node_modules" / "electron" / "dist"
    if not runtime.exists():
        raise SystemExit("[build] 缺少 Electron 运行时: {0}".format(runtime))
    # 摊平到产物根：UI 进程与宿主 exe 同级，两个 resources 目录自然合并（文件名不冲突）。
    copy_tree(runtime, target)
    # 早期布局残留的改名版 UI 进程，顺手清掉
    stale = target / executable_name("bigolive-streamer-ui")
    if stale.exists():
        stale.unlink()

    # assets/bin 里的东西直接铺到产物根（和 exe 同级），不留 bin/ 这一层
    if ASSETS_BIN_DIR.exists():
        copy_tree(ASSETS_BIN_DIR, target)

    app = target / "resources" / "app"
    app.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ELECTRON_DIR / "package.json", app / "package.json")
    copy_tree(ELECTRON_DIR / "dist", app / "dist")
    copy_tree(ELECTRON_DIR / "src" / "preload", app / "src" / "preload")
    copy_tree(ELECTRON_DIR / "src" / "renderer", app / "src" / "renderer")
    # 唯一的运行时依赖：生成的协议代码 import 'flatbuffers'
    copy_tree(
        ELECTRON_DIR / "node_modules" / "flatbuffers",
        app / "node_modules" / "flatbuffers",
    )

    log("产物目录（可分发）: {0}".format(target))
    return target


def build_all(config: str, stage_output: bool = True) -> None:
    build_native(config)
    prepare_electron()
    if stage_output:
        stage(config)


def main() -> int:
    parser = argparse.ArgumentParser(description="bigolive-streamer 构建脚本")
    parser.add_argument("--config", default="Debug", help="Debug / Release")
    parser.add_argument(
        "--no-stage", action="store_true", help="只构建，不铺 build/out/<config> 目录"
    )
    args = parser.parse_args()
    build_all(args.config, stage_output=not args.no_stage)
    return 0


if __name__ == "__main__":
    sys.exit(main())