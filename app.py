#!/usr/bin/env python3
import aws_cdk as cdk

from house_search.house_search_stack import HouseSearchStack

app = cdk.App()
HouseSearchStack(app, "HouseSearchStack")
app.synth()
