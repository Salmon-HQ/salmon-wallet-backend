'use strict';

/**
 * Pins the least-privilege shape of the GitHub deploy role's policy and the
 * Lambda role's permissions boundary. Neither file is applied by CI (an admin
 * publishes them in IAM, docs/DEPLOY.md), so a statement that loosens them
 * would otherwise only show up as an escalation path in the account.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const list = (value) => (Array.isArray(value) ? value : [value]);

const deploy = read('aws-deploy-policy.json');
const boundary = read('aws-lambda-permissions-boundary.json');
const BOUNDARY_NAME = 'gol-salmon-api-lambda-boundary';
const BOUNDARY_ARN = `arn:aws:iam::<AWS_ACCOUNT_ID>:policy/${BOUNDARY_NAME}`;

// Every IAM action that can grant a role permissions, change who may assume
// it, or create one.
const ROLE_WRITES = [
  'iam:CreateRole',
  'iam:PutRolePolicy',
  'iam:AttachRolePolicy',
  'iam:UpdateAssumeRolePolicy',
  'iam:PutRolePermissionsBoundary',
];

describe('deploy role policy', () => {
  const allows = deploy.Statement.filter((s) => s.Effect === 'Allow');

  it.each(ROLE_WRITES)('allows %s only on roles that carry the Lambda boundary', (action) => {
    const granting = allows.filter((s) => list(s.Action).includes(action));
    expect(granting.length).toBeGreaterThan(0);
    for (const statement of granting) {
      expect(statement.Condition).toEqual({
        ArnEquals: { 'iam:PermissionsBoundary': BOUNDARY_ARN },
      });
    }
  });

  it('grants no IAM action through a wildcard', () => {
    const iamActions = allows.flatMap((s) => list(s.Action)).filter((a) => a.startsWith('iam:'));
    expect(iamActions.filter((a) => a.includes('*'))).toEqual([]);
  });

  it('passes project roles, and only to Lambda', () => {
    const passing = allows.filter((s) => list(s.Action).includes('iam:PassRole'));
    expect(passing).toHaveLength(1);
    expect(passing[0].Resource).toBe('arn:aws:iam::<AWS_ACCOUNT_ID>:role/gol-salmon-api-*');
    expect(passing[0].Condition).toEqual({
      StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' },
    });
  });

  // A stack with a service role runs under that role, not the caller's, so
  // write access to any stack is access to whatever role it carries.
  it.each([
    'cloudformation:CreateStack',
    'cloudformation:UpdateStack',
    'cloudformation:DeleteStack',
    'cloudformation:CreateChangeSet',
    'cloudformation:ExecuteChangeSet',
    'cloudformation:DeleteChangeSet',
  ])('allows %s on the project stacks only', (action) => {
    const granting = allows.filter((s) =>
      list(s.Action).some(
        (a) => a === action || (a.endsWith('*') && action.startsWith(a.slice(0, -1)))
      )
    );
    expect(granting.length).toBeGreaterThan(0);
    for (const statement of granting) {
      expect(list(statement.Resource)).toEqual([
        'arn:aws:cloudformation:us-east-1:<AWS_ACCOUNT_ID>:stack/gol-salmon-api-*/*',
      ]);
    }
  });

  it('can neither remove a boundary nor edit the boundary policy', () => {
    const denied = deploy.Statement.filter((s) => s.Effect === 'Deny');
    const deniedOn = (action, resource) =>
      denied.some((s) => list(s.Action).includes(action) && list(s.Resource).includes(resource));
    expect(deniedOn('iam:DeleteRolePermissionsBoundary', '*')).toBe(true);
    for (const action of [
      'iam:CreatePolicyVersion',
      'iam:SetDefaultPolicyVersion',
      'iam:DeletePolicyVersion',
      'iam:DeletePolicy',
    ]) {
      expect(deniedOn(action, BOUNDARY_ARN)).toBe(true);
    }
  });

  // IAM refuses a managed policy over 6,144 characters, white space not counted.
  it('fits in one managed policy', () => {
    const size = JSON.stringify(deploy).replaceAll('<AWS_ACCOUNT_ID>', '123456789012').length;
    expect(size).toBeLessThanOrEqual(6144);
  });
});

describe('Lambda permissions boundary', () => {
  it('allows nothing in IAM and no wildcard action', () => {
    const actions = boundary.Statement.flatMap((s) => list(s.Action));
    expect(actions.filter((a) => a.startsWith('iam:') || a.includes('*'))).toEqual([]);
  });

  it('is the boundary serverless.yml puts on the Lambda role', () => {
    const serverless = fs.readFileSync(path.join(root, 'serverless.yml'), 'utf8');
    expect(serverless).toMatch(
      new RegExp(`^\\s*permissionsBoundary: .*:policy/${BOUNDARY_NAME}\\s*$`, 'm')
    );
  });
});
