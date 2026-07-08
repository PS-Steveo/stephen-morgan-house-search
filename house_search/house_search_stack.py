from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    CfnOutput,
    aws_cognito as cognito,
    aws_s3 as s3,
    aws_dynamodb as dynamodb,
    aws_lambda as _lambda,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as integrations,
    aws_apigatewayv2_authorizers as authorizers,
    aws_iam as iam,
    aws_secretsmanager as secretsmanager,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3_deployment as s3deploy,
)
from constructs import Construct


class HouseSearchStack(Stack):
    """
    Backend for the personal house-search app.

    Deliberately NOT included in this stack (build these next):
      - Frontend hosting (S3 + CloudFront, or Amplify Hosting)
      - The actual React/HTML dashboard
    This stack is the auth + data + API + extraction layer those will sit on top of.
    """

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ------------------------------------------------------------------
        # Auth -- Cognito user pool. self_sign_up is OFF on purpose: you
        # create the 4 accounts yourself (you, Morgan, realtor, loan officer)
        # via the console or CLI after deploy. Essentials is the default
        # feature plan and its free tier (10k MAU/mo) covers this trivially.
        # ------------------------------------------------------------------
        user_pool = cognito.UserPool(
            self, "HouseSearchUserPool",
            user_pool_name="house-search-users",
            self_sign_up_enabled=False,
            sign_in_aliases=cognito.SignInAliases(email=True, username=True),
            standard_attributes=cognito.StandardAttributes(
                email=cognito.StandardAttribute(required=True, mutable=True),
            ),
            custom_attributes={
                # "owner" (you + Morgan, full edit) or "viewer" (realtor, loan officer)
                "role": cognito.StringAttribute(mutable=True, max_len=20),
            },
            password_policy=cognito.PasswordPolicy(
                min_length=10,
                require_lowercase=True,
                require_uppercase=True,
                require_digits=True,
                require_symbols=False,
            ),
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            removal_policy=RemovalPolicy.RETAIN,
        )

        user_pool_client = user_pool.add_client(
            "HouseSearchWebClient",
            auth_flows=cognito.AuthFlow(user_srp=True),
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
            ),
            prevent_user_existence_errors=True,
        )

        # ------------------------------------------------------------------
        # Storage -- uploaded files (photos, MLS sheets, GIS/permit PDFs)
        # ------------------------------------------------------------------
        uploads_bucket = s3.Bucket(
            self, "UploadsBucket",
            removal_policy=RemovalPolicy.RETAIN,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            cors=[s3.CorsRule(
                allowed_methods=[s3.HttpMethods.PUT, s3.HttpMethods.GET],
                allowed_origins=["*"],  # tighten to your real frontend origin once it exists
                allowed_headers=["*"],
            )],
        )

        # ------------------------------------------------------------------
        # Data
        # ------------------------------------------------------------------
        properties_table = dynamodb.Table(
            self, "PropertiesTable",
            partition_key=dynamodb.Attribute(name="property_id", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )
        properties_table.add_global_secondary_index(
            index_name="status-index",
            partition_key=dynamodb.Attribute(name="status", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="added_date", type=dynamodb.AttributeType.STRING),
        )

        locations_table = dynamodb.Table(
            self, "LocationsTable",
            partition_key=dynamodb.Attribute(name="location_id", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        config_table = dynamodb.Table(
            self, "ConfigTable",
            partition_key=dynamodb.Attribute(name="config_id", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ------------------------------------------------------------------
        # Secret -- Anthropic API key. This stack creates an EMPTY secret;
        # you must populate it yourself after deploy (see README). Nothing
        # in this codebase can see or set the value for you.
        # ------------------------------------------------------------------
        anthropic_secret = secretsmanager.Secret(
            self, "AnthropicApiKey",
            secret_name="house-search/anthropic-api-key",
            description="Populate with your own Anthropic API key after deploy.",
        )

        # ------------------------------------------------------------------
        # Lambda: general API -- properties, locations, weights, distances
        # ------------------------------------------------------------------
        api_fn = _lambda.Function(
            self, "ApiFunction",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="handler.lambda_handler",
            code=_lambda.Code.from_asset("lambda/api"),
            timeout=Duration.seconds(15),
            memory_size=256,
            environment={
                "PROPERTIES_TABLE": properties_table.table_name,
                "LOCATIONS_TABLE": locations_table.table_name,
                "CONFIG_TABLE": config_table.table_name,
                "UPLOADS_BUCKET": uploads_bucket.bucket_name,
            },
        )
        properties_table.grant_read_write_data(api_fn)
        locations_table.grant_read_write_data(api_fn)
        config_table.grant_read_write_data(api_fn)
        uploads_bucket.grant_read_write(api_fn)
        api_fn.add_to_role_policy(iam.PolicyStatement(
            actions=["geo-places:Geocode", "geo-routes:CalculateRouteMatrix"],
            resources=[
                f"arn:aws:geo-places:{self.region}::provider/default",
                f"arn:aws:geo-routes:{self.region}::provider/default",
            ],
        ))

        # ------------------------------------------------------------------
        # Lambda: document extraction -- MLS text + GIS/permit PDFs -> Claude
        # ------------------------------------------------------------------
        extraction_fn = _lambda.Function(
            self, "ExtractionFunction",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="handler.lambda_handler",
            code=_lambda.Code.from_asset("lambda/extraction"),
            timeout=Duration.seconds(60),
            memory_size=512,
            environment={
                "PROPERTIES_TABLE": properties_table.table_name,
                "UPLOADS_BUCKET": uploads_bucket.bucket_name,
                "ANTHROPIC_SECRET_ARN": anthropic_secret.secret_arn,
            },
        )
        properties_table.grant_read_write_data(extraction_fn)
        uploads_bucket.grant_read(extraction_fn)
        anthropic_secret.grant_read(extraction_fn)

        # ------------------------------------------------------------------
        # API Gateway -- HTTP API, Cognito-authenticated
        # ------------------------------------------------------------------
        authorizer = authorizers.HttpUserPoolAuthorizer(
            "CognitoAuthorizer", user_pool, user_pool_clients=[user_pool_client],
        )

        http_api = apigwv2.HttpApi(
            self, "HouseSearchApi",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],  # tighten once you have a real frontend domain
                allow_methods=[apigwv2.CorsHttpMethod.ANY],
                allow_headers=["*", "Authorization", "Content-Type"],
            ),
        )

        api_integration = integrations.HttpLambdaIntegration("ApiIntegration", api_fn)
        extraction_integration = integrations.HttpLambdaIntegration("ExtractionIntegration", extraction_fn)

        # Explicit methods, NOT HttpMethod.ANY -- ANY expands to include
        # OPTIONS, which would attach the Cognito authorizer to CORS
        # preflight requests and break them (browsers send unauthenticated
        # OPTIONS preflights). Leaving OPTIONS unmatched lets HttpApi's
        # built-in cors_preflight handle it instead.
        api_methods = [
            apigwv2.HttpMethod.GET,
            apigwv2.HttpMethod.POST,
            apigwv2.HttpMethod.PATCH,
            apigwv2.HttpMethod.PUT,
            apigwv2.HttpMethod.DELETE,
        ]
        for path in ["/properties", "/properties/{proxy+}", "/locations", "/locations/{proxy+}", "/weights", "/maps-key"]:
            http_api.add_routes(
                path=path,
                methods=api_methods,
                integration=api_integration,
                authorizer=authorizer,
            )

        http_api.add_routes(
            path="/properties/{id}/extract",
            methods=[apigwv2.HttpMethod.POST],
            integration=extraction_integration,
            authorizer=authorizer,
        )

        # ------------------------------------------------------------------
        # Frontend hosting -- S3 (private, OAC-only) + CloudFront.
        # The Next.js static export (frontend/out) is deployed as part of
        # this same `cdk deploy` via BucketDeployment, so no extra AWS
        # permissions are needed beyond what the CDK bootstrap roles
        # already grant the deploying principal.
        # ------------------------------------------------------------------
        frontend_bucket = s3.Bucket(
            self, "FrontendBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.DESTROY,  # regenerable static assets, unlike the data resources above
            auto_delete_objects=True,
        )

        distribution = cloudfront.Distribution(
            self, "FrontendDistribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(frontend_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
            ),
            default_root_object="index.html",
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=404, response_http_status=200, response_page_path="/404.html",
                ),
            ],
            comment="House search frontend",
        )

        s3deploy.BucketDeployment(
            self, "FrontendDeployment",
            sources=[s3deploy.Source.asset("frontend/out")],
            destination_bucket=frontend_bucket,
            distribution=distribution,
            distribution_paths=["/*"],
        )

        # ------------------------------------------------------------------
        # Maps -- an Amazon Location API key scoped to read-only map-tile
        # actions, referer-locked to this CloudFront domain. CloudFormation
        # can't create AWS::Location::APIKey in this account (the exec role
        # hits an "no resource-based policy allows the action" error from
        # the geo-maps handler regardless of IAM permissions -- a CFN
        # resource-type quirk, not an access problem: creating the same key
        # directly via the CLI with the same role's permissions works
        # fine). So the key is created once out-of-band via the CLI --
        # see README.md -- and CDK only grants the Lambda permission to
        # read its value at request time (GET /maps-key hands it to the
        # frontend, rather than baking it into the static build).
        # ------------------------------------------------------------------
        maps_key_name = "house-search-maps-key"
        api_fn.add_environment("MAPS_KEY_NAME", maps_key_name)
        api_fn.add_to_role_policy(iam.PolicyStatement(
            actions=["geo:DescribeKey"],
            resources=[f"arn:aws:geo:{self.region}:{self.account}:api-key/{maps_key_name}"],
        ))

        # ------------------------------------------------------------------
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "UploadsBucketName", value=uploads_bucket.bucket_name)
        CfnOutput(self, "AnthropicSecretArn", value=anthropic_secret.secret_arn)
        CfnOutput(self, "FrontendUrl", value=f"https://{distribution.distribution_domain_name}")
