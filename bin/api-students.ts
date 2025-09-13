#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApiStudentsStack } from '../lib/api-students-stack';

const app = new cdk.App();

new ApiStudentsStack(app, 'ApiStudentsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
