"""Check tracked public files without printing secrets. Run from the repo root."""
import pathlib
import re
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
patterns = [
    rb"sk-or-v1-[A-Za-z0-9]{35,}",
    rb"\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{35,}",
    rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})",
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    rb"postgres(?:ql)?://[^\s:/]+:[^\s@]{5,}@",
]
errors = []
for name in filter(None, paths):
    path = root / name
    if name.startswith(("analysis/", "data/", "docs/incoming/")):
        errors.append((name, "private input or analytics"))
    if pathlib.Path(name).name.startswith(".env") and not name.endswith(".env.example"):
        errors.append((name, "environment file"))
    if "/.vercel/" in name or name.startswith(".vercel/"):
        errors.append((name, "local deployment configuration"))
    if path.is_file() and name != "scripts/check-distribution.py":
        blob = path.read_bytes()
        if any(re.search(pattern, blob) for pattern in patterns):
            errors.append((name, "possible secret"))
for name, reason in errors:
    print(f"FAIL {name}: {reason}")
if errors:
    raise SystemExit(1)
print("Distribution scan passed: private paths absent; no known secret patterns.")
