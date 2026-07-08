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

        for path in ["/properties", "/properties/{proxy+}", "/locations", "/locations/{proxy+}", "/weights"]:
            http_api.add_routes(
                path=path,
                methods=[apigwv2.HttpMethod.ANY],
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
        # Outputs
        # ------------------------------------------------------------------
        CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "UploadsBucketName", value=uploads_bucket.bucket_name)
        CfnOutput(self, "AnthropicSecretArn", value=anthropic_secret.secret_arn)
