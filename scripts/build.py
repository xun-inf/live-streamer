#!/usr/bin/env python3
"""live-streamer 构建脚本：原生侧（C++/CMake）+ Electron（tsc）。

用法：
    python scripts/build.py [--config Debug]

scripts/run.py 复用这里的函数（构建完再启动），两边不会各写一份。
Windows 包装：仓库根目录的 build-win-x84_64.bat。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE_DIR = ROOT / "core"
BUILD_DIR = ROOT / "build" / "core"
ELECTRON_DIR = ROOT / "electron"
# 随程序一起发出去的配置目录：图标（app.ico / tray.ico）和 bin 资源
CONFIG_DIR = ROOT / "config"
BIN_DIR = ROOT / "build" / "bin"

# 产物里的 UI 进程名：Electron 运行时本体改叫 live-streamer（electron-packager 同款做法），
# 进程名 / 任务栏 / 文件都和产品对得上；开发模式仍用 node_modules 里的 electron.exe
UI_EXE_NAME = "live-streamer"
LOG_DIR = ROOT / "build" / "logs"

# rcedit：改 UI 进程 exe 的 PE 资源（图标 / 版本信息）。跑的是官方运行时本体，
# 只有资源换成我们的，内置功能不动
RCEDIT_VERSION = "2.0.0"
RCEDIT_FILE = "rcedit-x64.exe"
RCEDIT_URL = "https://github.com/electron/rcedit/releases/download/v{0}/{1}".format(
    RCEDIT_VERSION, RCEDIT_FILE
)
RCEDIT_SHA256 = "3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a"
RCEDIT_DIR = ROOT / "core" / "thirdparty" / "rcedit"

# 写进 exe 资源的产品名（窗口标题见 electron/src/main/main.ts）
APP_PRODUCT_NAME = "LIVE Streamer"
APP_COMPANY_NAME = "ZXB"

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


def build_native(config: str, generator: str = "", toolset: str = "") -> None:
    configure = ["cmake", "-S", CORE_DIR, "-B", BUILD_DIR]
    if generator:
        configure += ["-G", generator]
    if IS_WINDOWS:
        configure += ["-A", "x64"]
    if toolset:
        configure += ["-T", toolset]
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
    """CMake 产物统一在 build/bin/<config>（单配置生成器没有 config 这一层）。"""
    folder = BIN_DIR
    candidates = [
        folder / config / executable_name(name),
        folder / executable_name(name),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def output_dir(config: str) -> Path:
    """产物目录 = CMake 的输出目录，也是最终的可分发目录：build/bin/<config>。

    单配置生成器（Ninja）没有 config 这一层，直接落在 build/bin。
    """
    return target_binary("media-service", config).parent



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


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_rcedit() -> Path:
    """rcedit 是单文件 exe：core/thirdparty/rcedit 里没有（或校验不符）就下载一份。"""
    tool = RCEDIT_DIR / RCEDIT_FILE
    if tool.exists() and file_sha256(tool) == RCEDIT_SHA256:
        return tool
    cache = ROOT / "build" / "tmp" / RCEDIT_FILE
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists() or file_sha256(cache) != RCEDIT_SHA256:
        log("下载 " + RCEDIT_URL)
        urllib.request.urlretrieve(RCEDIT_URL, cache)
    digest = file_sha256(cache)
    if digest != RCEDIT_SHA256:
        raise SystemExit(
            "[build] rcedit 校验失败：期望 {0}，实际 {1}".format(RCEDIT_SHA256, digest)
        )
    RCEDIT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(cache, tool)
    return tool


def electron_version() -> str:
    """版本信息跟 electron/package.json 走，不用两边各写一份。"""
    package = json.loads((ELECTRON_DIR / "package.json").read_text(encoding="utf-8"))
    return str(package.get("version", "0.0.0"))


def rename_runtime_exe(target: Path) -> None:
    """把摊平出来的 electron.exe 改成本产品的名字，产物里不留 electron 这层身份。"""
    source = target / executable_name("electron")
    destination = target / executable_name(UI_EXE_NAME)
    if not source.exists():
        if destination.exists():
            return
        raise SystemExit("[build] 缺少 Electron 运行时本体: {0}".format(source))
    if destination.exists():
        try:
            destination.unlink()
        except PermissionError:
            raise SystemExit(
                "[build] {0} 正被占用（应用还开着？），先关掉再构建".format(destination)
            )
    source.rename(destination)
    log("Electron 运行时改名: {0} -> {1}".format(source.name, destination.name))


def brand_ui_exe(target: Path) -> None:
    """用 rcedit 给产物里的 UI 进程 exe 换 PE 资源：图标 + 版本信息。"""
    exe = target / executable_name(UI_EXE_NAME)
    icon = CONFIG_DIR / "app.ico"
    if not exe.exists():
        raise SystemExit("[build] 缺少 Electron 运行时本体: {0}".format(exe))
    if not icon.exists():
        log("警告: {0} 不存在，{1} 不换图标".format(icon, exe.name))
        return
    version = electron_version()
    run_command(
        [
            ensure_rcedit(),
            exe,
            "--set-icon",
            icon,
            "--set-version-string",
            "ProductName",
            APP_PRODUCT_NAME,
            "--set-version-string",
            "FileDescription",
            APP_PRODUCT_NAME,
            "--set-version-string",
            "CompanyName",
            APP_COMPANY_NAME,
            "--set-file-version",
            version,
            "--set-product-version",
            version,
        ]
    )
    log("{0} 资源已更新（图标 + 版本 {1}）".format(exe.name, version))


def stage(config: str) -> Path:
    """把 Electron 运行时 + Electron 应用 + config/bin 铺进 CMake 的输出目录。

    产物目录（build/bin/<config>）就是最终的可分发目录：
        build/bin/<config>/
        ├── media-service.exe        # CMake 直接构建在这里（PE 图标带 config/app.ico）
        ├── live-streamer.exe + Chromium 运行时文件  # electron.exe 改的名，摊在根下（rcedit 换过图标/版本）
        ├── <config/bin 里的东西>     # settings.ini 等直接摊在根下，不留 bin/ 这一层
        ├── resources/               # Electron 自己的目录，只放它自己的东西
        │   ├── app/                 # 我们的 Electron 应用（main.js 按 ../../src 找 preload）
        │   └── default_app.asar     # Electron 自带，不用管
        └── logs/                    # 首次运行时自动创建

    config/ 本身不进产物：图标是构建期输入（.rc / rcedit 用），只有 bin/ 是运行时文件。
    启动：live-streamer.exe resources/app
    """
    binary = target_binary("media-service", config)
    if not binary.exists():
        raise SystemExit("[build] 缺少构建产物: {0}".format(binary))
    target = binary.parent
    target.mkdir(parents=True, exist_ok=True)

    # 旧布局把整个 config/ 拷进产物；现在只摊 bin/，顺手清掉这个残留目录
    legacy_config = target / "config"
    if legacy_config.is_dir():
        shutil.rmtree(legacy_config)
        log("清理旧产物目录: {0}".format(legacy_config))

    runtime = ELECTRON_DIR / "node_modules" / "electron" / "dist"
    if not runtime.exists():
        raise SystemExit("[build] 缺少 Electron 运行时: {0}".format(runtime))
    # 摊平到产物根：我们的 exe 和 electron 运行时同级
    copy_tree(runtime, target)
    # 运行时本体改成本产品的名字，再换图标 / 版本
    rename_runtime_exe(target)
    brand_ui_exe(target)

    # config/bin 里的东西直接铺到产物根（和 exe 同级），不留 bin/ 这一层
    config_bin = CONFIG_DIR / "bin"
    if config_bin.exists():
        copy_tree(config_bin, target)
    else:
        log("警告: {0} 不存在，产物里没有 settings.ini 这类运行时文件".format(config_bin))

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


def build_all(
    config: str,
    stage_output: bool = True,
    generator: str = "",
    toolset: str = "",
) -> None:
    build_native(config, generator, toolset)
    prepare_electron()
    if stage_output:
        stage(config)


def main() -> int:
    parser = argparse.ArgumentParser(description="live-streamer 构建脚本")
    parser.add_argument("--config", default="Debug", help="Debug / Release")
    parser.add_argument(
        "--generator", default="", help="CMake generator，例如 Visual Studio 18 2026"
    )
    parser.add_argument("--toolset", default="", help="CMake toolset，例如 v145")
    parser.add_argument(
        "--no-stage", action="store_true", help="只构建，不铺 build/bin/<config> 目录"
    )
    args = parser.parse_args()
    build_all(
        args.config,
        stage_output=not args.no_stage,
        generator=args.generator,
        toolset=args.toolset,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
