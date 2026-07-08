# House search app

Personal house-search tool: upload MLS sheets, GIS/permit PDFs, and photos
per property; AI extracts the structured fields; everything gets scored
against weights you control. You and Morgan each vote yes/maybe/no/need-info
per property and see each other's votes; all geocoded properties show up
on a satellite map. Shared with your realtor and loan officer as read-only.

Full design rationale, data model, and open decisions: `PROJECT_SPEC.md`.

## What's in this stack

- **Cognito** user pool for the 4 logins (you, Morgan, realtor, loan officer)
- **S3** bucket for uploaded files (photos, MLS sheets, GIS/permit PDFs) +
  a second bucket serving the static frontend behind **CloudFront**
- **DynamoDB** -- `Properties`, `Locations` (your commute/errand anchor list), `Config` (weights + scoring bounds)
- **API Gateway (HTTP API)** + 2 **Lambda** functions:
  - `api` -- CRUD for properties/locations/weights, presigned upload URLs,
    geocoding on property create, yes/maybe/no/need-info voting, the
    Amazon Location Maps API key handoff
  - `extraction` -- sends uploaded documents to Claude, writes structured fields back
- **Secrets Manager** secret for your Anthropic API key (created empty -- you populate it)
- **Amazon Location Service**: `geo-places` for geocoding addresses on
  property create, `geo-maps` (satellite tiles) for the map view, via an
  API key created manually (see deploy step 9 -- CloudFormation can't
  create this resource type in this account)
- **Frontend** (`frontend/`) -- Next.js static export: property tiles
  with live scoring and voting, a satellite map, weight sliders, and a
  locations editor. Deployed via GitHub Actions -> OIDC -> `cdk deploy`,
  which also runs the frontend's `BucketDeployment` as part of the same
  stack.

## Deploy steps

The frontend's static build gets deployed to S3/CloudFront as part of
`cdk deploy` itself (via `BucketDeployment`), and it needs the backend's
own outputs (`ApiUrl`, `UserPoolId`, `UserPoolClientId`) baked in at
*build* time. On a brand-new account those outputs don't exist until
after a deploy, so the very first setup is two passes: deploy once to
create everything, rebuild the frontend with the real values, deploy
again. Every deploy after that is a single pass, since the values don't
change once the resources exist.

1. **Prerequisites**: an AWS account with credentials configured locally
   (`aws configure`), Python 3.12, Node.js (for the CDK CLI and
   frontend), and an Anthropic API key.

2. **Install the CDK CLI** (if you don't have it):
   ```bash
   npm install -g aws-cdk
   ```

3. **Set up the Python environment and vendor both Lambdas' dependencies**
   (boto3 ships with the Lambda runtime, but `lambda/api` needs a newer
   boto3/botocore than the runtime may bundle -- it's the only client
   that knows about `geo-places`/`geo-maps`, added Nov 2024 -- and
   `lambda/extraction` needs `anthropic`, which isn't in the runtime at
   all):
   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ./lambda/api/build.sh
   ./lambda/extraction/build.sh
   ```

4. **Bootstrap CDK** (one-time per AWS account/region, skip if you've
   done this before):
   ```bash
   PATH="$PWD/.venv/bin:$PATH" cdk bootstrap
   ```

5. **Build the frontend once with placeholder/empty env vars**, just so
   `frontend/out` exists for the first deploy to package:
   ```bash
   cd frontend && npm ci && npm run build && cd ..
   ```

6. **First deploy**:
   ```bash
   PATH="$PWD/.venv/bin:$PATH" cdk deploy
   ```
   Note the outputs -- `ApiUrl`, `UserPoolId`, `UserPoolClientId`,
   `FrontendUrl`, `AnthropicSecretArn`, `UploadsBucketName`.

7. **Rebuild the frontend with the real values** and redeploy so
   CloudFront serves a working build:
   ```bash
   cd frontend
   NEXT_PUBLIC_API_URL=<ApiUrl> \
   NEXT_PUBLIC_USER_POOL_ID=<UserPoolId> \
   NEXT_PUBLIC_USER_POOL_CLIENT_ID=<UserPoolClientId> \
   npm run build
   cd ..
   PATH="$PWD/.venv/bin:$PATH" cdk deploy
   ```
   (For CI, these are GitHub Actions repo *variables*, not secrets --
   see `.github/workflows/deploy.yml`. They're not sensitive; they end
   up in the public JS bundle regardless.)

8. **Populate the Anthropic API key** (the stack creates the secret but
   deliberately leaves it empty -- nothing in this codebase should ever
   see or set your key for you):
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id house-search/anthropic-api-key \
     --secret-string "sk-ant-your-key-here"
   ```

9. **Create the Amazon Location Maps API key** (one-time, manual --
   CloudFormation can't create `AWS::Location::APIKey` in this account;
   the `cdk-hnb659fds-cfn-exec-role` hits an "no resource-based policy
   allows the action" error from the geo-maps handler no matter what IAM
   permissions it has. Creating the same key directly via the CLI works
   fine, so that's the workaround -- the Lambda just reads its value at
   request time via `GET /maps-key`, so this can happen any time after
   step 6, independent of deploy order). Use your real `FrontendUrl`
   from step 6:
   ```bash
   aws location create-key \
     --key-name house-search-maps-key \
     --no-expiry \
     --restrictions '{"AllowActions":["geo-maps:GetTile","geo-maps:GetStaticMap"],"AllowResources":["arn:aws:geo-maps:us-east-1::provider/default"],"AllowReferers":["https://<your-cloudfront-domain>/*","http://localhost:3000/*"]}'
   ```
   Note: only `GetTile` and `GetStaticMap` are valid `AllowActions` today
   -- `GetStyleDescriptor`/`GetSprites`/`GetGlyphs` aren't yet accepted
   restriction actions (despite being real API operations) and including
   them makes `create-key` fail the same way `AWS::Location::APIKey`
   does in CloudFormation. `GetTile` alone is enough in practice --
   style/sprite/glyph requests aren't actually gated separately.

10. **Create your 4 user accounts** (self-signup is off on purpose):
    ```bash
    aws cognito-idp admin-create-user \
      --user-pool-id <UserPoolId from stack output> \
      --username you \
      --user-attributes Name=email,Value=you@example.com Name=custom:role,Value=owner \
      --desired-delivery-mediums EMAIL
    ```
    Repeat for Morgan (`role=owner`), your realtor, and your loan officer
    (`role=viewer` for both). `custom:role` is enforced in
    `lambda/api/handler.py`: viewers get full read access, including
    weights and the map, but any non-GET request is rejected with 403.
    Usernames can't be email-formatted since the pool uses email as a
    sign-in alias -- pass the real address via the `email` attribute.

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
