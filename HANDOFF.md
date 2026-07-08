# House search app — handoff for Claude Code

Paste this whole file as your opening message in the new session (after
attaching/pushing this repo to GitHub). It has everything needed to
pick up where this planning conversation left off.

## What this is

A personal house-search tool for Stephen and Morgan: upload MLS sheets,
GIS/permit PDFs, and photos per property; AI extracts structured
fields; everything scores against configurable weights. Shared with
their realtor and loan officer via separate logins. Ongoing tool, not
a one-time comparison.

## Current state — read before doing anything

The backend is **scaffolded and structurally validated, not deployed**.
`cdk synth` produces a clean CloudFormation template (1 Cognito pool, 3
DynamoDB tables, 2 Lambdas, 6 API routes, 1 S3 bucket, 1 secret) — but
it has never been run against a real AWS account, so first deploy is
the real test. Expect small things to need fixing on that first run
(IAM permission gaps are the most likely category, particularly around
`geo-places`/`geo-routes` action names, which are new enough that
they're worth double-checking against current AWS docs before trusting
the CDK code blindly).

No frontend exists yet.

## Decisions already locked in (don't re-litigate these)

- **Scope**: ongoing tool for new listings, not just current finalists.
- **Extraction**: Claude reads uploaded PDFs/images natively — no
  Textract. Model is `claude-haiku-4-5-20251001`.
- **Photos**: reference/gallery only, not a scoring factor.
- **Scoring**: fixed reference bounds per factor (not min-max across
  the current batch) so scores don't shift as properties are added.
  Starting weights ported from an earlier Excel model: price 20,
  commute 20, safety 20, HOA 10, $/sqft 10, year built 10, total sqft
  10.
- **Auth**: Cognito, 4 manually-created accounts (self-signup off).

## Architecture

Cognito (auth) → API Gateway (HTTP API) → 2 Lambdas:
- `api` — CRUD for properties/locations/weights, presigned S3 upload
  URLs, distance lookups via Amazon Location Service
- `extraction` — fetches an uploaded file from S3, sends it to Claude,
  writes structured fields back to DynamoDB, flags `needs_review` if a
  key field (price/sqft/year built) comes back missing or low-confidence

Data in DynamoDB: `Properties`, `Locations`, `Config` (weights + bounds).
Anthropic API key lives in Secrets Manager, created empty on purpose.

Full data model, API surface, and scoring formula: see `PROJECT_SPEC.md`
in this repo. Deploy steps: see `README.md`.

## Open items — still need a decision

- **Permission granularity.** `custom:role` (owner/viewer) exists on
  the Cognito user pool but the API doesn't check it. Needs enforcing
  before the realtor/loan officer accounts actually get created —
  right now every login has identical edit access, including to the
  weight config, which reveals negotiating priorities.
- **Location description** (original requirement #5): still undecided
  whether this is free-text notes, a pulled signal, or both.
- **Auto-fetching GIS report cards by address** for counties on
  Beacon/Schneider Geospatial or Marion County's own portal, instead
  of requiring manual upload.
- **Permit-vs-MLS cross-check**: flag upgrade claims ("new roof 2023")
  that don't have a matching permit.
- **Distance-to-locations wiring**: the Location Service calls and IAM
  permissions exist in `lambda/api`, but nothing calls them
  automatically yet when a property is added.
- **Data lifecycle** after closing on a house — `status=archived`
  exists, nothing auto-archives.

## Suggested next steps, in order

1. Get this code into the repo if it isn't already (it's a full CDK
   Python project — `app.py`, `house_search/`, `lambda/`).
2. `cdk bootstrap` + `cdk deploy` against a real AWS account. Fix
   whatever breaks — especially double-check the Location Service IAM
   action names before relying on them.
3. Populate the Anthropic API key in Secrets Manager (`README.md` step 7).
4. Create the 4 Cognito accounts (`README.md` step 8) — but resolve
   the permission-granularity open item first if realtor/loan officer
   access is going out soon.
5. Smoke-test end to end: create a property, get a presigned upload
   URL, upload a real MLS PDF, trigger `/extract`, confirm the fields
   land correctly and `needs_review` behaves as expected.
6. Build the frontend: property list/comparison view, weight sliders,
   upload flow, photo gallery. This is the biggest remaining chunk of
   work.
