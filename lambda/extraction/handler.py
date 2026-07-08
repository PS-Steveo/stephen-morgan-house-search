"""
Document extraction handler.

Triggered explicitly by POST /properties/{id}/extract (called by the
frontend right after it finishes uploading a file -- no S3 event
plumbing needed for a v1). Fetches the file from S3, sends it straight
to Claude (Claude reads PDFs and images natively, so there's no
Textract step in this design), asks for structured JSON back, and
writes the result onto the property record.

Needs the `anthropic` package vendored into this directory before
`cdk deploy` -- see README.md. boto3 does not need vendoring; it
ships with the Lambda Python runtime.
"""
import json
import os
import base64
import mimetypes
import boto3
import anthropic

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
secretsmanager = boto3.client("secretsmanager")

properties_table = dynamodb.Table(os.environ["PROPERTIES_TABLE"])
UPLOADS_BUCKET = os.environ["UPLOADS_BUCKET"]
ANTHROPIC_SECRET_ARN = os.environ["ANTHROPIC_SECRET_ARN"]

MODEL = "claude-haiku-4-5-20251001"  # cheap + fast; matches what you're already using for Home Assistant

# Field sets differ per document type. KEY_FIELDS are the ones that
# materially move the score -- if Claude can't find these with
# confidence, the property gets flagged "needs_review" rather than
# silently scoring on a guess.
FIELD_SCHEMAS = {
    "mls": {
        "fields": ["price", "beds", "baths", "total_sqft", "lot_size_acres",
                   "year_built", "hoa", "days_on_market", "remarks_summary"],
        "key_fields": ["price", "total_sqft", "year_built"],
    },
    "gis": {
        "fields": ["assessed_value", "lot_size_acres", "zoning", "tax_district",
                   "flood_zone", "year_built", "total_sqft", "sale_history_summary"],
        "key_fields": ["assessed_value", "total_sqft"],
    },
    "detailed": {
        "fields": ["construction_type", "stories", "roof_type", "heating_type",
                   "total_sqft", "finished_basement_sqft", "garage_type"],
        "key_fields": ["total_sqft"],
    },
    "permit": {
        "fields": ["permit_type", "issued_date", "description", "status"],
        "key_fields": ["permit_type", "issued_date"],
    },
}


def _get_anthropic_client():
    secret = secretsmanager.get_secret_value(SecretId=ANTHROPIC_SECRET_ARN)
    api_key = secret["SecretString"]
    return anthropic.Anthropic(api_key=api_key)


def _fetch_file(key):
    obj = s3.get_object(Bucket=UPLOADS_BUCKET, Key=key)
    data = obj["Body"].read()
    content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
    return data, content_type


def _build_content_block(data, content_type):
    b64 = base64.b64encode(data).decode("utf-8")
    if content_type == "application/pdf":
        return {"type": "document", "source": {"type": "base64", "media_type": content_type, "data": b64}}
    if content_type.startswith("image/"):
        return {"type": "image", "source": {"type": "base64", "media_type": content_type, "data": b64}}
    # plain text fallback (e.g. a pasted-in .txt MLS description)
    return {"type": "text", "text": data.decode("utf-8", errors="replace")}


def extract_fields(client, data, content_type, file_type):
    schema = FIELD_SCHEMAS.get(file_type, FIELD_SCHEMAS["mls"])
    field_list = ", ".join(schema["fields"])
    prompt = (
        f"Extract the following fields from this {file_type} document: {field_list}.\n"
        "Return ONLY a JSON object (no markdown fences, no commentary) with two top-level keys:\n"
        '  "fields": an object with each field name above as a key. Use null for anything '
        "not present in the document -- never guess or estimate a value that isn't stated.\n"
        '  "low_confidence": a list of field names you are NOT confident about, even if you '
        "filled in a value (e.g. text was blurry, ambiguous, or you had to infer formatting).\n"
        "Numbers should be plain numbers (no $ signs or commas)."
    )
    content_block = _build_content_block(data, content_type)
    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": [content_block, {"type": "text", "text": prompt}]}],
    )
    raw = "".join(block.text for block in message.content if block.type == "text").strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}, [], f"could not parse model output: {raw[:200]}"
    return parsed.get("fields", {}), parsed.get("low_confidence", []), None


def lambda_handler(event, context):
    path_params = event.get("pathParameters") or {}
    property_id = path_params.get("id")
    body = json.loads(event["body"]) if event.get("body") else {}
    file_type = body.get("file_type")
    key = body.get("key")  # S3 key returned earlier by POST /properties/{id}/files

    if not property_id or not file_type or not key:
        return {"statusCode": 400, "body": json.dumps({"error": "property_id, file_type, and key are required"})}

    try:
        data, content_type = _fetch_file(key)
        client = _get_anthropic_client()
        fields, low_confidence, parse_error = extract_fields(client, data, content_type, file_type)
    except anthropic.AuthenticationError:
        # The secret exists but is empty/invalid -- see README.md step 8.
        # Surfacing the raw SDK message ("invalid x-api-key") to a
        # non-technical user is more confusing than helpful.
        return {"statusCode": 500, "body": json.dumps({
            "error": "The house-search app isn't set up to read documents yet "
                     "(no Anthropic API key). Ask whoever manages the AWS account to add one."
        })}
    except Exception as exc:  # noqa: BLE001
        return {"statusCode": 500, "body": json.dumps({
            "error": "Something went wrong reading that document. You can still fill in the numbers by hand below.",
            "detail": str(exc),
        })}

    schema = FIELD_SCHEMAS.get(file_type, FIELD_SCHEMAS["mls"])
    key_fields_missing_or_flagged = [
        f for f in schema["key_fields"]
        if fields.get(f) is None or f in low_confidence
    ]
    needs_review = bool(key_fields_missing_or_flagged) or bool(parse_error)

    update_expr_parts = [f"extracted_{file_type} = :fields", "extraction_status = :status"]
    expr_values = {
        ":fields": fields,
        ":status": "needs_review" if needs_review else "complete",
    }
    # Promote extracted fields onto the top-level property record too, so
    # the scoring function (in the api Lambda) can read them directly.
    for field_name, value in fields.items():
        if value is not None and field_name in (
            "price", "total_sqft", "year_built", "hoa", "beds", "baths",
        ):
            safe_name = f"f{len(update_expr_parts)}"
            update_expr_parts.append(f"{field_name} = :{safe_name}")
            expr_values[f":{safe_name}"] = value

    properties_table.update_item(
        Key={"property_id": property_id},
        UpdateExpression="SET " + ", ".join(update_expr_parts),
        ExpressionAttributeValues=expr_values,
    )

    return {
        "statusCode": 200,
        "body": json.dumps({
            "property_id": property_id,
            "file_type": file_type,
            "fields": fields,
            "low_confidence": low_confidence,
            "needs_review": needs_review,
            "parse_error": parse_error,
        }),
    }
