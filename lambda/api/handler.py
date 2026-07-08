"""
General API handler for the house-search app.

Behind API Gateway HTTP API (v2 payload format), one Lambda routes on
method + path. Kept as a single function on purpose -- at this scale
(a handful of users, a handful to a few dozen properties) a router
inside one Lambda is simpler to deploy and reason about than five
separate functions.

Scores are computed at READ time (not stored), using whatever the
current weight config and normalization bounds are. That means
editing weights or bounds re-ranks everything immediately with no
backfill step, and no property's score goes stale just because you
haven't touched it recently.
"""
import json
import os
import uuid
import time
import decimal
import boto3

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
geo_places = boto3.client("geo-places")
location_client = boto3.client("location")  # classic API -- used only for DescribeKey

properties_table = dynamodb.Table(os.environ["PROPERTIES_TABLE"])
locations_table = dynamodb.Table(os.environ["LOCATIONS_TABLE"])
config_table = dynamodb.Table(os.environ["CONFIG_TABLE"])
UPLOADS_BUCKET = os.environ["UPLOADS_BUCKET"]
MAPS_KEY_NAME = os.environ.get("MAPS_KEY_NAME")

VALID_VOTES = ("yes", "maybe", "no", "more_info")

DEFAULT_CONFIG = {
    "config_id": "default",
    # Sums to 100. Starting point ported from the Redfin ranking exercise --
    # price/commute/safety carried the most weight there too. Adjust freely;
    # nothing else in the code cares what these add up to.
    "weights": {
        "price": 20,
        "commute": 20,
        "safety": 20,
        "hoa": 10,
        "price_per_sqft": 10,
        "year_built": 10,
        "total_sqft": 10,
    },
    # Fixed reference points, NOT the min/max of your current listings.
    # This is what makes scores stable as you add new properties over time --
    # a property's score only changes when its own data changes.
    # "best" = the value that scores 100, "worst" = the value that scores 0.
    "bounds": {
        "price": {"best": 240000, "worst": 320000},
        "commute_minutes": {"best": 10, "worst": 35},
        "hoa": {"best": 0, "worst": 75},
        "price_per_sqft": {"best": 110, "worst": 180},
        "year_built": {"best": 2020, "worst": 1960},
        "total_sqft": {"best": 2400, "worst": 1200},
    },
}


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def _to_decimal(obj):
    """DynamoDB's boto3 resource requires Decimal, not float, for numbers."""
    if isinstance(obj, float):
        return decimal.Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def get_config():
    resp = config_table.get_item(Key={"config_id": "default"})
    return resp.get("Item", DEFAULT_CONFIG)


def normalize(value, best, worst):
    """Linear-interpolate value onto a 0-100 scale. Works whether higher
    or lower raw values are better -- direction comes from best vs worst."""
    if value is None:
        return None
    best, worst, value = float(best), float(worst), float(value)
    if best == worst:
        return 100.0
    pct = (value - worst) / (best - worst)
    return max(0.0, min(100.0, pct * 100.0))


def compute_score(prop, config):
    weights = config["weights"]
    bounds = config["bounds"]
    factor_values = {
        "price": prop.get("price"),
        "commute": prop.get("commute_minutes"),
        "safety": prop.get("safety_score"),  # already 0-100 (CrimeGrade-derived), used directly
        "hoa": prop.get("hoa"),
        "price_per_sqft": prop.get("price_per_sqft"),
        "year_built": prop.get("year_built"),
        "total_sqft": prop.get("total_sqft"),
    }

    weighted_sum, weight_total, subscores = 0.0, 0.0, {}
    for factor, weight in weights.items():
        raw = factor_values.get(factor)
        if raw is None:
            continue  # missing data (e.g. not extracted yet) -- excluded, not penalized
        if factor == "safety":
            norm = max(0.0, min(100.0, float(raw)))
        else:
            b = bounds.get(factor) or bounds.get(f"{factor}_minutes")
            norm = normalize(raw, b["best"], b["worst"]) if b else None
        if norm is None:
            continue
        subscores[factor] = round(norm, 1)
        weighted_sum += norm * float(weight)
        weight_total += float(weight)

    overall = round(weighted_sum / weight_total, 1) if weight_total > 0 else None
    return overall, subscores


def list_properties(qs):
    status = (qs or {}).get("status", "active")
    resp = properties_table.query(
        IndexName="status-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("status").eq(status),
        ScanIndexForward=False,
    )
    config = get_config()
    items = resp.get("Items", [])
    for item in items:
        item["score"], item["subscores"] = compute_score(item, config)
    items.sort(key=lambda p: (p["score"] is None, -(p["score"] or 0)))
    return _response(200, {"properties": items, "count": len(items)})


def geocode_address(address):
    """Best-effort -- a property with a bad/unrecognized address still gets
    created, it just won't show up on the map until lat/lng are set some
    other way (e.g. a future manual override)."""
    if not address:
        return None, None
    try:
        resp = geo_places.geocode(QueryText=address, MaxResults=1)
        items = resp.get("ResultItems") or []
        if not items:
            return None, None
        lng, lat = items[0]["Position"]  # Amazon Location returns [lng, lat]
        return lat, lng
    except Exception:  # noqa: BLE001 -- geocoding failure shouldn't block property creation
        return None, None


def create_property(body):
    now = int(time.time())
    property_id = str(uuid.uuid4())
    address = body.get("address", "")
    lat, lng = geocode_address(address)
    item = {
        "property_id": property_id,
        "status": "active",
        "added_date": str(now),
        "address": address,
        "notes": body.get("notes", ""),
        "extraction_status": "pending",
        "photo_keys": [],
        "votes": {},
    }
    if lat is not None and lng is not None:
        item["lat"] = lat
        item["lng"] = lng
    properties_table.put_item(Item=_to_decimal(item))
    return _response(201, item)


def get_property(property_id):
    resp = properties_table.get_item(Key={"property_id": property_id})
    item = resp.get("Item")
    if not item:
        return _response(404, {"error": "not found"})
    item["score"], item["subscores"] = compute_score(item, get_config())
    return _response(200, item)


def update_property(property_id, body):
    resp = properties_table.get_item(Key={"property_id": property_id})
    if not resp.get("Item"):
        return _response(404, {"error": "not found"})
    updates = _to_decimal({k: v for k, v in body.items() if k != "property_id"})
    expr_names = {f"#{k}": k for k in updates}
    expr_values = {f":{k}": v for k, v in updates.items()}
    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    properties_table.update_item(
        Key={"property_id": property_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    return get_property(property_id)


def archive_property(property_id):
    # Soft delete only -- see PROJECT_SPEC.md on why. Real deletion is a
    # deliberate follow-up action, not exposed as a default DELETE route.
    properties_table.update_item(
        Key={"property_id": property_id},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "archived"},
    )
    return _response(200, {"property_id": property_id, "status": "archived"})


def presigned_upload_url(property_id, body):
    file_type = body.get("file_type", "photo")  # photo | mls | gis | detailed | permit
    file_name = body.get("file_name", f"{uuid.uuid4()}.pdf")
    # Must match the Content-Type header the client actually sends on the PUT --
    # S3 includes whatever Content-Type is on the real request when it verifies
    # the signature, so if it's not part of what we signed here, the upload
    # gets rejected with SignatureDoesNotMatch.
    content_type = body.get("content_type") or "application/octet-stream"
    key = f"properties/{property_id}/{file_type}/{file_name}"
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": UPLOADS_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=300,
    )
    return _response(200, {"upload_url": url, "key": key})


def cast_vote(property_id, body, email):
    vote = body.get("vote")
    if vote not in VALID_VOTES:
        return _response(400, {"error": f"vote must be one of {', '.join(VALID_VOTES)}"})
    resp = properties_table.get_item(Key={"property_id": property_id})
    item = resp.get("Item")
    if not item:
        return _response(404, {"error": "not found"})
    votes = item.get("votes") or {}
    votes[email] = vote
    properties_table.update_item(
        Key={"property_id": property_id},
        UpdateExpression="SET votes = :v",
        ExpressionAttributeValues={":v": votes},
    )
    return _response(200, {"property_id": property_id, "votes": votes})


def get_maps_key():
    if not MAPS_KEY_NAME:
        return _response(500, {"error": "maps key not configured"})
    resp = location_client.describe_key(KeyName=MAPS_KEY_NAME)
    return _response(200, {"api_key": resp["Key"], "region": os.environ["AWS_REGION"]})


def presigned_download_url(qs):
    key = (qs or {}).get("key")
    if not key:
        return _response(400, {"error": "key query parameter required"})
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": UPLOADS_BUCKET, "Key": key},
        ExpiresIn=300,
    )
    return _response(200, {"download_url": url})


def list_locations():
    resp = locations_table.scan()
    return _response(200, {"locations": resp.get("Items", [])})


def create_location(body):
    location_id = str(uuid.uuid4())
    item = {
        "location_id": location_id,
        "label": body.get("label", "Untitled"),
        "address": body.get("address", ""),
    }
    locations_table.put_item(Item=item)
    return _response(201, item)


def delete_location(location_id):
    locations_table.delete_item(Key={"location_id": location_id})
    return _response(200, {"location_id": location_id, "deleted": True})


def get_weights():
    return _response(200, get_config())


def put_weights(body):
    config = get_config()
    if "weights" in body:
        config["weights"] = body["weights"]
    if "bounds" in body:
        config["bounds"] = body["bounds"]
    config_table.put_item(Item=_to_decimal(config))
    return _response(200, config)


def _role(event):
    """custom:role comes through as a Cognito JWT claim on authenticated
    requests. Missing/unset defaults to viewer (fail closed), not owner."""
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    return claims.get("custom:role", "viewer")


def _email(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    return claims.get("email", "unknown")


def lambda_handler(event, context):
    method = event["requestContext"]["http"]["method"]
    path = event["requestContext"]["http"]["path"]
    parts = [p for p in path.strip("/").split("/") if p]
    qs = event.get("queryStringParameters") or {}
    body = json.loads(event["body"]) if event.get("body") else {}

    # Viewers (realtor, loan officer) get read-only access -- they can see
    # everything owners see, including weights, but can't change anything.
    if method != "GET" and _role(event) != "owner":
        return _response(403, {"error": "read-only access for this account"})

    try:
        if parts == ["properties"] and method == "GET":
            return list_properties(qs)
        if parts == ["properties"] and method == "POST":
            return create_property(body)
        if len(parts) == 2 and parts[0] == "properties" and method == "GET":
            return get_property(parts[1])
        if len(parts) == 2 and parts[0] == "properties" and method == "PATCH":
            return update_property(parts[1], body)
        if len(parts) == 2 and parts[0] == "properties" and method == "DELETE":
            return archive_property(parts[1])
        if len(parts) == 3 and parts[0] == "properties" and parts[2] == "files" and method == "POST":
            return presigned_upload_url(parts[1], body)
        if len(parts) == 3 and parts[0] == "properties" and parts[2] == "files" and method == "GET":
            return presigned_download_url(qs)
        if len(parts) == 3 and parts[0] == "properties" and parts[2] == "vote" and method == "PUT":
            return cast_vote(parts[1], body, _email(event))

        if parts == ["maps-key"] and method == "GET":
            return get_maps_key()

        if parts == ["locations"] and method == "GET":
            return list_locations()
        if parts == ["locations"] and method == "POST":
            return create_location(body)
        if len(parts) == 2 and parts[0] == "locations" and method == "DELETE":
            return delete_location(parts[1])

        if parts == ["weights"] and method == "GET":
            return get_weights()
        if parts == ["weights"] and method == "PUT":
            return put_weights(body)

        return _response(404, {"error": f"no route for {method} {path}"})
    except Exception as exc:  # noqa: BLE001 -- top-level handler, want a clean 500 not a cryptic Lambda crash
        return _response(500, {"error": str(exc)})
