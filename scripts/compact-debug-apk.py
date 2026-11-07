"""Rewrite a debug APK without the large alignment padding Gradle sometimes leaves.

The result is unsigned. The caller zip-aligns it and signs it with the Android
debug keystore. This does not create a release key.
"""
import sys
import zipfile
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        out = zipfile.ZipInfo(filename=info.filename, date_time=info.date_time)
        if info.filename.endswith(".so"):
            out.compress_type = zipfile.ZIP_STORED
        else:
            out.compress_type = zipfile.ZIP_DEFLATED
        zout.writestr(out, data)
print(dst)
