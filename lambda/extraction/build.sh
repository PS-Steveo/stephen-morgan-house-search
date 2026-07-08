#!/usr/bin/env bash
# Vendors the extraction Lambda's Python dependencies (just `anthropic` --
# boto3 already ships with the Lambda runtime, no need to vendor it).
# Run this once before every `cdk deploy` that touches lambda/extraction/.
set -euo pipefail
cd "$(dirname "$0")"
pip install --upgrade --target . -r requirements.txt
echo "Vendored dependencies into lambda/extraction/. Safe to run cdk deploy now."
