# House search app -- backend

Personal house-search tool: upload MLS sheets, GIS/permit PDFs, and photos
per property; AI extracts the structured fields; everything gets scored
against weights you control. This package is the **backend only** --
auth, data, API, and document extraction. No frontend yet (see "What's
not here" below).

Full design rationale, data model, and open decisions: `PROJECT_SPEC.md`.

## What's in this stack

- **Cognito** user pool for the 4 logins (you, Morgan, realtor, loan officer)
- **S3** bucket for uploaded files (photos, MLS sheets, GIS/permit PDFs)
- **DynamoDB** -- `Properties`, `Locations` (your commute/errand anchor list), `Config` (weights + scoring bounds)
- **API Gateway (HTTP API)** + 2 **Lambda** functions:
  - `api` -- CRUD for properties/locations/weights, presigned upload URLs, distance lookups
  - `extraction` -- sends uploaded documents to Claude, writes structured fields back
- **Secrets Manager** secret for your Anthropic API key (created empty -- you populate it)

Validated with `cdk synth` -- it synthesizes cleanly to a CloudFormation
template. It has **not** been deployed against a real AWS account from
here, since this chat doesn't have access to yours.

## What's NOT here (deliberately)

- **Frontend.** No dashboard, no weight sliders UI, no property cards.
  The API is ready for one -- that's the natural next piece to build,
  and a better fit for an environment where you can actually run `npm
  run dev` and see it live (Claude Code, or continue here).
- **Distance calc wiring in the frontend.** The IAM permissions and the
  `geo-places` / `geo-routes` calls are ready in `lambda/api`, but
  there's no route yet that ties "add a property" to "auto-fetch its
  distances." Small addition once the frontend exists.
- **Auto-fetching GIS report cards by address.** The extraction pipeline
  handles documents you upload. Pulling Marion County / Beacon data
  live by address (mentioned earlier) is a follow-up, not core to this
  pass.

## Deploy steps

1. **Prerequisites**: an AWS account with credentials configured locally
   (`aws configure`), Python 3.12, Node.js (for the CDK CLI), and an
   Anthropic API key.

2. **Install the CDK CLI** (if you don't have it):
   ```bash
   npm install -g aws-cdk
   ```

3. **Set up the Python environment**:
   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

4. **Vendor the extraction Lambda's dependencies** (boto3 ships with
   Lambda already; `anthropic` does not):
   ```bash
   ./lambda/extraction/build.sh
   ```

5. **Bootstrap CDK** (one-time per AWS account/region, skip if you've
   done this before):
   ```bash
   .venv/bin/cdk bootstrap
   ```
   (or `PATH="$PWD/.venv/bin:$PATH" cdk bootstrap` if `cdk` isn't on
   your PATH inside the venv)

6. **Deploy**:
   ```bash
   PATH="$PWD/.venv/bin:$PATH" cdk deploy
   ```
   Review the IAM/security-sensitive changes it prompts you about, then
   confirm.

7. **Populate the Anthropic API key** (the stack creates the secret but
   deliberately leaves it empty -- nothing in this codebase should ever
   see or set your key for you):
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id house-search/anthropic-api-key \
     --secret-string "sk-ant-your-key-here"
   ```

8. **Create your 4 user accounts** (self-signup is off on purpose):
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id <UserPoolId from stack output> \
     --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=custom:role,Value=owner \
     --desired-delivery-mediums EMAIL
   ```
   Repeat for Morgan (`role=owner`), your realtor, and your loan officer
   (`role=viewer` for both -- the API doesn't yet enforce this
   distinction, see PROJECT_SPEC.md's open items).

9. **Note the outputs** -- `cdk deploy` prints `ApiUrl`, `UserPoolId`,
   and `UserPoolClientId`. The frontend (whenever it's built) needs all
   three.

## Cost

At 4 users and a handful to a few dozen properties, this should run
well under $5/month -- Cognito and Location Service both have free
tiers that comfortably cover this scale, and S3/DynamoDB/Lambda costs
at this volume are fractions of a cent. See PROJECT_SPEC.md for the
breakdown.

## Tearing it down

```bash
PATH="$PWD/.venv/bin:$PATH" cdk destroy
```
Note: the DynamoDB tables, S3 bucket, and Cognito user pool are set to
`RETAIN` on deletion (so a `cdk destroy` doesn't accidentally wipe your
property data or force everyone to re-register) -- you'll need to
delete those manually afterward if you actually want them gone.
