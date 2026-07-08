#!/usr/bin/env bash
# Vendors a recent boto3/botocore into this Lambda instead of relying on
# whatever the Lambda Python runtime happens to bundle -- geo-places and
# geo-maps (Amazon Location's Nov 2024 API surface) aren't guaranteed to be
# in an older runtime-provided botocore. Run this once before every
# `cdk deploy` that touches lambda/api/.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m pip install --upgrade --target . -r requirements.txt 2>/dev/null || python -m pip install --upgrade --target . -r requirements.txt
echo "Vendored dependencies into lambda/api/. Safe to run cdk deploy now."
