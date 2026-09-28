"""Package an allowlisted source export and an already-built portable app."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def archive(directory, output):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=7) as zipped:
        for file in sorted(directory.rglob('*')):
            if file.is_symlink():
                raise RuntimeError(f'Refusing symlink: {file}')
            if file.is_file():
                zipped.write(file, (Path(directory.name) / file.relative_to(directory)).as_posix())
    with zipfile.ZipFile(output) as zipped:
        if zipped.testzip() is not None:
            raise RuntimeError(f'Corrupt archive: {output}')

def main():
    version = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-dir', type=Path, default=ROOT/'release'/f'Moye-{version}')
    args = parser.parse_args()
    app = args.app_dir.resolve()
    for name in ['Moye.exe', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'ui/index.html']:
        if not (app/name).is_file():
            raise RuntimeError(f'Missing app file: {app/name}')
    if (app/'LICENSE').read_bytes() != (ROOT/'LICENSE').read_bytes():
        raise RuntimeError('Build the app with the current project license before packaging.')
    subprocess.run(['node', str(ROOT/'scripts/export-source.mjs')], cwd=ROOT, check=True)
    out=ROOT/'release/github-ready'
    source=out/'moye-source'
    archive(source, out/'moye-source.zip')
    app_zip=out/f'Moye-{version}-Windows-x64.zip'
    archive(app, app_zip)
    video=out/'Moye-intro-1080p.mp4'
    shutil.copy2(ROOT/'docs/media/moye-intro.mp4',video)
    shutil.copy2(ROOT/'docs/GITHUB_DESCRIPTION.txt',out/'GITHUB_DESCRIPTION.txt')
    instructions='''# GitHub 发布准备包

- `moye-source.zip`：解压后，将 `moye-source` 文件夹内的内容上传到仓库。已包含 README、Apache-2.0 许可证、5 张界面截图、封面、宣传片及构建脚本。
- `Moye-'''+version+'''-Windows-x64.zip`：Windows 便携软件，放到 GitHub Releases。
- `Moye-intro-1080p.mp4`：约 40 秒横版 1080p 宣传片，使用作者提供的最终剪辑版本。
- `GITHUB_DESCRIPTION.txt`：复制到仓库的 About 简介。
- `SHA256SUMS.txt`：下载文件的校验值。

源码未包含依赖缓存、测试输出、私人样例或本机设置。完整发布步骤见源码中的 `docs/PUBLISHING.md`。

本脚本只在本地生成文件；远程发布状态请查看项目的 GitHub 仓库。
'''
    (out/'START_HERE.md').write_text(instructions,encoding='utf-8')
    packages=[out/'moye-source.zip',app_zip,video]
    checksums=[]
    for package in packages:
        checksums.append(hashlib.sha256(package.read_bytes()).hexdigest()+'  '+package.name)
        print(f'{package.name}: {package.stat().st_size:,} bytes',flush=True)
    (out/'SHA256SUMS.txt').write_text('\n'.join(checksums)+'\n',encoding='utf-8')
    with zipfile.ZipFile(out/'moye-source.zip') as zipped:
        names=zipped.namelist()
        required=['.gitignore','.github/workflows/build.yml','LICENSE','README.md','docs/media/moye-intro.mp4']
        if any('moye-source/'+name not in names for name in required):
            raise RuntimeError('Missing required source archive entries')
        if any(any(part in {'node_modules','.build','test-results','.git'} for part in Path(name).parts) for name in names):
            raise RuntimeError('Unexpected generated/private directory in source archive')
    print('Archives verified, including dotfiles and media.',flush=True)

if __name__=='__main__':
    main()
