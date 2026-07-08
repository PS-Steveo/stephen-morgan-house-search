# House search app -- project spec

Personal tool for evaluating houses against weighted criteria, shared
with your realtor and loan officer alongside you and Morgan. Ongoing --
not a one-time comparison of a fixed list.

## Requirements (as given, plus what got settled)

| # | Item | Status |
|---|------|--------|
| 1 | MLS description upload | AI-extracted (Claude, native PDF/text read) |
| 2 | House pictures | Reference only -- displayed, not scored |
| 3 | GIS + Detailed property report cards | AI-extracted; auto-fetch by address is a follow-up |
| 4 | Permits | AI-extracted; cross-check against MLS upgrade claims is a follow-up |
| 5 | Location description | Deferred -- see Open items |
| -- | Distance to saved locations | Amazon Location Service; list is user-editable in-app |
| -- | Login for 4 people | Cognito, 4 admin-created accounts, no self-signup |
| -- | Scope | Ongoing tool, not limited to current finalists |

## Data model (DynamoDB)

### `Properties`
One item per property. Partition key `property_id` (UUID). GSI
`status-index` (partition `status`, sort `added_date`) for listing
active vs. archived properties.

```
property_id, status (active|archived), added_date, address, notes
price, beds, baths, total_sqft, hoa, year_built, price_per_sqft   # promoted from extraction, or manually entered
commute_minutes, safety_score                                     # from distance calc / location description work
extracted_mls, extracted_gis, extracted_detailed, extracted_permit  # full extraction payloads, nested
extraction_status (pending|complete|needs_review)
photo_keys []                                                     # S3 keys, reference only
```

Scores are **computed at read time**, not stored -- see Scoring below
for why.

### `Locations`
Your editable list of frequently-visited anchors (work, Morgan's work,
golf course, etc.). Partition key `location_id`.
```
location_id, label, address, lat, lng (populated on first geocode)
```

### `Config`
Single item, `config_id = "default"`. Holds the weights and the
scoring bounds (see below). One shared config for now -- see Open
items re: per-user weight profiles.

## Scoring

Your Excel model (32 -> 9 finalists) used **min-max normalization**:
each factor was scaled 0-100 relative to the *current batch* of
listings. That's the right approach for a point-in-time comparison of
a fixed set. It's the wrong approach for an ongoing tool, because
every time you add a new listing, the min/max bounds shift and
*every other property's score moves too* -- confusing when you're
tracking things over weeks.

This app uses **fixed reference points** instead: you set a "best"
and "worst" value per factor once (e.g. price: $240k = 100 points,
$320k = 0 points), and those stay put. A property's score only
changes when *its own* data changes. Starting weights ported from
what you'd already validated:

```
price: 20, commute: 20, safety: 20, hoa: 10,
price_per_sqft: 10, year_built: 10, total_sqft: 10
```

Missing data (a factor not yet extracted) is **excluded** from that
property's score, not treated as zero -- a property doesn't get
penalized just because you haven't uploaded its permit history yet.

Photos are not a scoring factor per your answer -- gallery only.

## Extraction pipeline

1. Frontend requests a presigned upload URL (`POST /properties/{id}/files`), uploads the file straight to S3.
2. Frontend calls `POST /properties/{id}/extract` with the file's S3 key and type (`mls`/`gis`/`detailed`/`permit`).
3. The `extraction` Lambda fetches the file and sends it directly to Claude (Haiku tier -- same as your Home Assistant setup) as a native PDF/image input, asking for a fixed JSON schema back.
4. Fields land in `extracted_<type>` on the property record; the handful that actually move the score (price, sqft, year built, etc.) also get promoted to top-level fields.
5. If Claude can't find a **key field**, or flags one as low-confidence, the property gets marked `needs_review` instead of silently scoring on a bad read. This isn't a full manual-confirm step (you asked for auto-extract, not hybrid) -- it's a narrower safety net just on the fields that would actually distort the ranking.

No Textract in this design -- Claude reads PDFs natively, so it's one
integration instead of two.

## API surface

```
GET    /properties?status=active       list, with computed scores
POST   /properties                     create (address, notes)
GET    /properties/{id}                single property + score
PATCH  /properties/{id}                update any field
DELETE /properties/{id}                archive (soft delete, not destructive)
POST   /properties/{id}/files          get a presigned S3 upload URL
POST   /properties/{id}/extract        trigger extraction on an uploaded file
GET    /locations                      list saved anchor addresses
POST   /locations                      add one
DELETE /locations/{id}                 remove one
GET    /weights                        current weights + bounds
PUT    /weights                        update weights and/or bounds
```

Everything requires a Cognito-authenticated request.

## Cost estimate

| Service | Free tier at this scale | Beyond free tier |
|---|---|---|
| Cognito | 10,000 MAU/mo (Essentials, the default) -- 4 users is nothing | $0.015/MAU |
| Location Service | 10,000 geocode requests/mo for 3 months | fractions of a cent for a few dozen calls |
| Textract | n/a -- not used | n/a |
| Claude API (extraction) | -- | a few cents per document at Haiku pricing |
| S3 / DynamoDB / Lambda | generous free tiers, all well under at this volume | negligible |

**Realistic total: under $5/month**, most of it S3 storage for photos.

## Open items (not yet built)

- ~~**Permission granularity.**~~ Resolved: `custom:role` is enforced
  in `lambda/api/handler.py` -- `viewer` accounts (realtor, loan
  officer) get read access to everything, including weights, but any
  non-GET request is rejected with 403. Missing/unset role defaults to
  viewer (fail closed).
- **Location description (item 5).** Still undecided whether this is
  free-text notes, a pulled signal (CrimeGrade-style, matching your
  existing safety scoring), or both.
- **Auto-fetching GIS report cards by address**, for counties that run
  on Beacon/Schneider Geospatial or Marion County's own portal --
  would remove the manual-upload step for that document type
  entirely.
- **Permit-vs-MLS cross-check** (flag "new roof 2023" claims that
  don't have a matching permit).
- ~~**Geocoding on property create.**~~ Resolved: `create_property` in
  `lambda/api/handler.py` calls `geo-places:Geocode` on the address and
  stores `lat`/`lng`, best-effort (a bad address still creates the
  property, it just won't appear on the map). Properties created before
  this shipped don't have `lat`/`lng` retroactively.
- **Commute-distance wiring** -- still open. Geocoding happens, and the
  `geo-routes:CalculateRouteMatrix` IAM permission exists in
  `lambda/api`, but nothing yet calls it against the saved `Locations`
  list to populate `commute_minutes` automatically.
- **Data lifecycle** -- what happens to a property's record after you
  close. Archive is already there (`status=archived`); nothing
  auto-archives yet.
- ~~**Frontend.**~~ Resolved: Next.js static export in `frontend/`,
  deployed via CloudFront. Property tiles with live scoring and
  yes/maybe/no/need-info voting (owners only cast votes; viewers see
  them), a satellite map (Amazon Location `geo-maps`, markers geocoded
  on create), weight sliders, locations editor, upload + extraction
  flow, photo gallery.
