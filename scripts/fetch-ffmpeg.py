#!/usr/bin/env python3
"""拉取 FFmpeg 预编译包并铺进 core/thirdparty/ffmpeg（可重复跑，已铺好就跳过）。

用法：
    python scripts/fetch-ffmpeg.py            # 缺什么补什么
    python scripts/fetch-ffmpeg.py --force    # 重新下载、重新铺

来源：BtbN 的 FFmpeg-Builds（GitHub Releases）win64 lgpl shared 包，稳定分支 8.1.3。
只铺测试片源真正用到的部分（本地视频解码）：
    include/libavcodec libavformat libavutil libswscale        # 头文件
    lib/{avcodec,avformat,avutil,swscale}.lib                  # 链接用导入库
    bin/{avcodec-62,avformat-62,avutil-60,swscale-9,swresample-6}.dll   # 运行时 DLL
LICENSE.txt 一并铺过去；换版本时改下面的 TAG / ARCHIVE / SHA256 三个常量。
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "core" / "thirdparty" / "ffmpeg"
TEMP_DIR = ROOT / "build" / "tmp"

TAG = "autobuild-2026-09-22-13-18"
ARCHIVE = "ffmpeg-n8.1.3-win64-lgpl-shared-8.1.zip"
URL = (
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/"
    + TAG
    + "/"
    + ARCHIVE
)
SHA256 = "d1be0e64c0fae2e6c2061bd24c6f61e4b4ad9f962d8fd9240731a77a48b06f71"

INCLUDE_DIRS = ["libavcodec", "libavformat", "libavutil", "libswscale"]
IMPORT_LIBS = ["avcodec.lib", "avformat.lib", "avutil.lib", "swscale.lib"]
RUNTIME_DLLS = [
    "avcodec-62.dll",
    "avformat-62.dll",
    "avutil-60.dll",
    "swscale-9.dll",
    "swresample-6.dll",
]


def configure_streams() -> None:
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
    print("[ffmpeg] " + message, flush=True)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(archive: Path, force: bool) -> None:
    if archive.exists() and not force:
        if file_sha256(archive) == SHA256:
            log("压缩包已存在且校验通过: {0}".format(archive))
            return
        log("压缩包校验不符，重新下载")
    archive.parent.mkdir(parents=True, exist_ok=True)
    log("下载 " + URL)
    urllib.request.urlretrieve(URL, archive)
    digest = file_sha256(archive)
    if digest != SHA256:
        raise SystemExit(
            "[ffmpeg] sha256 不符：期望 {0}，实际 {1}".format(SHA256, digest)
        )
    log("下载完成，sha256 校验通过")


def extract(archive: Path) -> Path:
    with zipfile.ZipFile(archive) as package:
        # 包解压出来是 ffmpeg-<版本>-win64-.../ 一层目录
        root_name = package.namelist()[0].split("/")[0]
        source = TEMP_DIR / "ffmpeg" / root_name
        if not source.exists():
            log("解压到 " + str(TEMP_DIR / "ffmpeg"))
            package.extractall(TEMP_DIR / "ffmpeg")
        return source


def stage(source: Path) -> None:
    for include in INCLUDE_DIRS:
        target = DEST / "include" / include
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source / "include" / include, target)
    (DEST / "lib").mkdir(parents=True, exist_ok=True)
    (DEST / "bin").mkdir(parents=True, exist_ok=True)
    for name in IMPORT_LIBS:
        shutil.copy2(source / "lib" / name, DEST / "lib" / name)
    for name in RUNTIME_DLLS:
        shutil.copy2(source / "bin" / name, DEST / "bin" / name)
    shutil.copy2(source / "LICENSE.txt", DEST / "LICENSE.txt")
    log("已铺到 " + str(DEST))


def main() -> int:
    parser = argparse.ArgumentParser(description="拉取 FFmpeg 到 core/thirdparty")
    parser.add_argument("--force", action="store_true", help="重新下载并重新铺")
    args = parser.parse_args()

    archive = TEMP_DIR / ARCHIVE
    download(archive, args.force)
    source = extract(archive)
    stage(source)
    return 0


if __name__ == "__main__":
    sys.exit(main())
