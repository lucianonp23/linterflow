import { Injectable, NestMiddleware, ForbiddenException, UnauthorizedException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export type PolicyEffect = 'ALLOW' | 'DENY';

export enum ActionType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXECUTE = 'EXECUTE',
  MANAGE = 'MANAGE',
  AUDIT = 'AUDIT',
}

export enum SecurityClassification {
  PUBLIC = 0,
  INTERNAL = 1,
  CONFIDENTIAL = 2,
  RESTRICTED = 3,
  TOP_SECRET = 4,
}

export interface UserDelegation {
  delegatorId: string;
  roles: string[];
  expiresAt: number;
  scope: string;
}

export interface UserContext {
  id: string;
  tenantId: string;
  roles: string[];
  clearanceLevel: SecurityClassification;
  ipAddress: string;
  geoCountry?: string;
  isSuperAdmin: boolean;
  delegations: UserDelegation[];
  attributes: Record<string, any>;
  emergencyBypassToken?: string;
}

export interface ResourceContext {
  id: string;
  type: string;
  tenantId: string;
  path: string;
  classification: SecurityClassification;
  ownerId?: string;
  attributes: Record<string, any>;
  tags: string[];
}

export interface PolicyCondition {
  field: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'GREATER_THAN' | 'LESS_THAN' | 'CONTAINS' | 'MATCHES_PATTERN' | 'IP_IN_RANGE';
  value: any;
}

export interface PolicyRule {
  id: string;
  name: string;
  priority: number;
  effect: PolicyEffect;
  roles: string[];
  actions: (ActionType | string)[];
  resources: string[];
  conditions?: PolicyCondition[];
  timeWindow?: {
    startHourUTC: number;
    endHourUTC: number;
    allowedDaysOfWeek: number[];
  };
  environmentRestrictions?: {
    allowedIPRanges?: string[];
    allowedCountries?: string[];
    disallowMaintenanceWindow?: boolean;
  };
}

export interface AccessPolicySet {
  tenantId: string;
  version: string;
  rules: PolicyRule[];
}

const OPERATOR_STRATEGIES: Record<
  string,
  (left: any, right: any, instance: AccessControlPolicyMiddleware) => boolean
> = {
  EQUALS: (left, right) => left === right,
  NOT_EQUALS: (left, right) => left !== right,
  GREATER_THAN: (left, right) => left > right,
  LESS_THAN: (left, right) => left < right,
  IN: (left, right) => Array.isArray(right) && right.includes(left),
  NOT_IN: (left, right) => !Array.isArray(right) || !right.includes(left),
  CONTAINS: (left, right) => {
    if (Array.isArray(left)) {
      return left.includes(right);
    }
    if (typeof left === 'string') {
      return left.includes(String(right));
    }
    return false;
  },
  MATCHES_PATTERN: (left, right) => typeof left === 'string' && new RegExp(String(right)).test(left),
  IP_IN_RANGE: (left, right, instance) => typeof left === 'string' && instance['isIPInCIDR'](left, String(right)),
};

@Injectable()
export class AccessControlPolicyMiddleware implements NestMiddleware {
  private readonly roleHierarchy: Map<string, string[]> = new Map([
    ['SYSTEM_ADMIN', ['TENANT_ADMIN', 'SECURITY_OFFICER', 'AUDITOR', 'PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER']],
    ['TENANT_ADMIN', ['PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER']],
    ['SECURITY_OFFICER', ['AUDITOR', 'VIEWER']],
    ['PROJECT_MANAGER', ['CONTRIBUTOR', 'VIEWER']],
    ['CONTRIBUTOR', ['VIEWER']],
    ['AUDITOR', ['VIEWER']],
    ['VIEWER', []],
  ]);

  private readonly globalPolicyStore: AccessPolicySet[] = [
    {
      tenantId: '*',
      version: '1.0.0',
      rules: [
        {
          id: 'rule-super-admin-override',
          name: 'Super Admin Full Access',
          priority: 1000,
          effect: 'ALLOW',
          roles: ['SYSTEM_ADMIN'],
          actions: ['*'],
          resources: ['*'],
        },
        {
          id: 'rule-deny-maintenance-general',
          name: 'Block standard users during maintenance',
          priority: 950,
          effect: 'DENY',
          roles: ['CONTRIBUTOR', 'VIEWER'],
          actions: ['CREATE', 'UPDATE', 'DELETE'],
          resources: ['*'],
          environmentRestrictions: {
            disallowMaintenanceWindow: true,
          },
        },
      ],
    },
    {
      tenantId: 'tenant-alpha',
      version: '2.1.0',
      rules: [
        {
          id: 'rule-alpha-owner-manage',
          name: 'Owner full resource access',
          priority: 500,
          effect: 'ALLOW',
          roles: ['PROJECT_MANAGER', 'TENANT_ADMIN'],
          actions: ['READ', 'UPDATE', 'DELETE', 'MANAGE'],
          resources: ['projects/*', 'documents/*'],
          conditions: [
            {
              field: 'resource.ownerId',
              operator: 'EQUALS',
              value: '${user.id}',
            },
          ],
        },
        {
          id: 'rule-alpha-confidential-read',
          name: 'Restricted high clearance access',
          priority: 400,
          effect: 'ALLOW',
          roles: ['SECURITY_OFFICER', 'TENANT_ADMIN'],
          actions: ['READ'],
          resources: ['documents/confidential/*'],
          conditions: [
            {
              field: 'user.clearanceLevel',
              operator: 'GREATER_THAN',
              value: SecurityClassification.CONFIDENTIAL,
            },
          ],
        },
        {
          id: 'rule-alpha-deny-ip-range',
          name: 'Deny restricted subnet for write',
          priority: 900,
          effect: 'DENY',
          roles: ['*'],
          actions: ['CREATE', 'UPDATE', 'DELETE'],
          resources: ['financial/*'],
          environmentRestrictions: {
            allowedIPRanges: ['10.0.0.0/8', '192.168.1.0/24'],
          },
        },
        {
          id: 'rule-alpha-business-hours-only',
          name: 'Restrict operations to business hours',
          priority: 300,
          effect: 'ALLOW',
          roles: ['CONTRIBUTOR'],
          actions: ['CREATE', 'UPDATE'],
          resources: ['tasks/*', 'tickets/*'],
          timeWindow: {
            startHourUTC: 6,
            endHourUTC: 22,
            allowedDaysOfWeek: [1, 2, 3, 4, 5],
          },
        },
      ],
    },
  ];

  private isSystemInMaintenance: boolean = false;

  public use(req: Request, res: Response, next: NextFunction): void {
    try {
      const user = this.extractUserContext(req);
      const resource = this.extractResourceContext(req);
      const action = this.resolveAction(req);

      if (this.checkEmergencyBypass(user, req, res)) {
        return next();
      }

      if (!this.validateTenantBoundary(user, resource)) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Cross-tenant access violation detected',
          code: 'TENANT_MISMATCH',
        });
      }

      const effectiveRoles = this.resolveEffectiveRoles(user);
      const applicablePolicies = this.getApplicablePolicies(user.tenantId);

      const evaluationResult = this.evaluateAccessDecision(
        user,
        resource,
        action,
        effectiveRoles,
        applicablePolicies,
        req
      );

      if (evaluationResult.decision === 'DENY') {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          message: `Access denied by policy rule: ${evaluationResult.matchedRuleId || 'DEFAULT_DENY'}`,
          reason: evaluationResult.reason,
          code: 'ACCESS_DENIED_BY_POLICY',
        });
      }

      res.setHeader('X-Access-Control-Evaluated', 'true');
      res.setHeader('X-Access-Control-Decision', 'ALLOW');
      if (evaluationResult.matchedRuleId) {
        res.setHeader('X-Access-Control-Rule-Id', evaluationResult.matchedRuleId);
      }

      next();
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Policy evaluation error encountered',
        details: error instanceof Error ? error.message : 'Unknown evaluation failure',
      });
    }
  }

  private extractUserContext(req: Request): UserContext {
    const headers = req.headers;
    const userId = (headers['x-user-id'] as string) || 'anonymous';
    const tenantId = (headers['x-tenant-id'] as string) || 'guest-tenant';
    const rawRoles = (headers['x-user-roles'] as string) || 'GUEST';
    const roles = rawRoles.split(',').map((r) => r.trim());
    const clearance = parseInt((headers['x-user-clearance'] as string) || '0', 10);
    const ipAddress = (headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const isSuperAdmin = headers['x-super-admin'] === 'true' || roles.includes('SYSTEM_ADMIN');

    return {
      id: userId,
      tenantId,
      roles,
      clearanceLevel: isNaN(clearance) ? SecurityClassification.PUBLIC : clearance,
      ipAddress: ipAddress.split(',')[0].trim(),
      geoCountry: headers['x-geo-country'] as string,
      isSuperAdmin,
      delegations: this.parseDelegations(headers['x-user-delegations'] as string),
      attributes: this.parseAttributes(headers['x-user-attributes'] as string),
      emergencyBypassToken: headers['x-emergency-bypass-token'] as string,
    };
  }

  private parseDelegations(delegationHeader?: string): UserDelegation[] {
    if (!delegationHeader) {
      return [];
    }
    try {
      const parsed = JSON.parse(delegationHeader);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const delegations: UserDelegation[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (item && item.delegatorId && Array.isArray(item.roles) && typeof item.expiresAt === 'number') {
          delegations.push(item);
        }
      }
      return delegations;
    } catch {
      return [];
    }
  }

  private parseAttributes(attrHeader?: string): Record<string, any> {
    if (!attrHeader) {
      return {};
    }
    try {
      return JSON.parse(attrHeader);
    } catch {
      return {};
    }
  }

  private extractResourceContext(req: Request): ResourceContext {
    const classificationVal = parseInt((req.headers['x-resource-classification'] as string) || '0', 10);

    return {
      id: this.extractResourceId(req),
      type: (req.headers['x-resource-type'] as string) || this.deriveResourceTypeFromPath(req.path),
      tenantId: this.extractResourceTenantId(req),
      path: req.path.startsWith('/') ? req.path.substring(1) : req.path,
      classification: isNaN(classificationVal) ? SecurityClassification.PUBLIC : classificationVal,
      ownerId: this.extractResourceOwnerId(req),
      attributes: this.extractResourceAttributes(req),
      tags: this.extractResourceTags(req),
    };
  }

  private extractResourceId(req: Request): string {
    const headerId = req.headers['x-resource-id'] as string;
    if (headerId) return headerId;
    if (req.params && req.params['id']) return req.params['id'];
    return 'global';
  }

  private extractResourceTenantId(req: Request): string {
    const resTenant = req.headers['x-resource-tenant-id'] as string;
    if (resTenant) return resTenant;
    const tenant = req.headers['x-tenant-id'] as string;
    if (tenant) return tenant;
    return 'guest-tenant';
  }

  private extractResourceOwnerId(req: Request): string | undefined {
    const headerOwner = req.headers['x-resource-owner-id'] as string;
    if (headerOwner) return headerOwner;
    if (req.query && req.query['ownerId']) return req.query['ownerId'] as string;
    return undefined;
  }

  private extractResourceAttributes(req: Request): Record<string, any> {
    let attributes: Record<string, any> = {};
    if (req.body && typeof req.body === 'object') {
      attributes = { ...req.body };
    }
    if (req.query && typeof req.query === 'object') {
      attributes = { ...attributes, ...req.query };
    }
    return attributes;
  }

  private extractResourceTags(req: Request): string[] {
    const tagsHeader = req.headers['x-resource-tags'] as string;
    if (tagsHeader) {
      return tagsHeader.split(',').map((t) => t.trim());
    }
    return [];
  }

  private deriveResourceTypeFromPath(path: string): string {
    const cleaned = path.replace(/^\/api\/v\d+\//, '').replace(/^\//, '');
    const segments = cleaned.split('/');
    return segments[0] ? segments[0].toLowerCase() : 'unknown';
  }

  private resolveAction(req: Request): ActionType | string {
    const customAction = req.headers['x-action-override'] as string;
    if (customAction) {
      return customAction.toUpperCase();
    }

    switch (req.method.toUpperCase()) {
      case 'GET':
      case 'HEAD':
      case 'OPTIONS':
        return ActionType.READ;
      case 'POST':
        return ActionType.CREATE;
      case 'PUT':
      case 'PATCH':
        return ActionType.UPDATE;
      case 'DELETE':
        return ActionType.DELETE;
      default:
        return req.method.toUpperCase();
    }
  }

  private checkEmergencyBypass(user: UserContext, req: Request, res: Response): boolean {
    if (user.emergencyBypassToken && user.isSuperAdmin) {
      if (user.emergencyBypassToken === 'CRITICAL_OVERRIDE_SECRET_99') {
        res.setHeader('X-Access-Control-Bypass', 'TRUE_EMERGENCY');
        return true;
      }
    }
    return false;
  }

  private validateTenantBoundary(user: UserContext, resource: ResourceContext): boolean {
    if (user.isSuperAdmin) {
      return true;
    }
    if (user.tenantId === '*' || resource.tenantId === '*') {
      return true;
    }
    if (user.tenantId !== resource.tenantId) {
      if (user.roles.includes('CROSS_TENANT_AUDITOR') && resource.classification <= SecurityClassification.CONFIDENTIAL) {
        return true;
      }
      return false;
    }
    return true;
  }

  private resolveEffectiveRoles(user: UserContext): Set<string> {
    const effectiveRoles = new Set<string>();
    const now = Date.now();

    const expandRole = (role: string) => {
      if (effectiveRoles.has(role)) return;
      effectiveRoles.add(role);
      const inherited = this.roleHierarchy.get(role);
      if (inherited && inherited.length > 0) {
        for (let i = 0; i < inherited.length; i++) {
          expandRole(inherited[i]);
        }
      }
    };

    for (let i = 0; i < user.roles.length; i++) {
      expandRole(user.roles[i]);
    }

    if (user.delegations && user.delegations.length > 0) {
      for (let i = 0; i < user.delegations.length; i++) {
        const del = user.delegations[i];
        if (del.expiresAt > now) {
          for (let j = 0; j < del.roles.length; j++) {
            expandRole(del.roles[j]);
          }
        }
      }
    }

    return effectiveRoles;
  }

  private getApplicablePolicies(tenantId: string): PolicyRule[] {
    const applicableRules: PolicyRule[] = [];

    for (let i = 0; i < this.globalPolicyStore.length; i++) {
      const pSet = this.globalPolicyStore[i];
      if (pSet.tenantId === '*' || pSet.tenantId === tenantId) {
        for (let j = 0; j < pSet.rules.length; j++) {
          applicableRules.push(pSet.rules[j]);
        }
      }
    }

    return applicableRules.sort((a, b) => b.priority - a.priority);
  }

  private evaluateAccessDecision(
    user: UserContext,
    resource: ResourceContext,
    action: ActionType | string,
    roles: Set<string>,
    rules: PolicyRule[],
    req: Request
  ): { decision: PolicyEffect; matchedRuleId?: string; reason?: string } {
    let allowRuleId: string | undefined;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];

      if (!this.isRuleApplicable(rule, user, resource, action, roles, req)) {
        continue;
      }

      if (rule.effect === 'DENY') {
        return {
          decision: 'DENY',
          matchedRuleId: rule.id,
          reason: `Explicit DENY by high priority rule: ${rule.name}`,
        };
      }

      if (rule.effect === 'ALLOW' && !allowRuleId) {
        allowRuleId = rule.id;
      }
    }

    if (allowRuleId) {
      return {
        decision: 'ALLOW',
        matchedRuleId: allowRuleId,
      };
    }

    return {
      decision: 'DENY',
      reason: 'Implicit DEFAULT_DENY (No rule matched or granted explicit ALLOW)',
    };
  }

  private isRuleApplicable(
    rule: PolicyRule,
    user: UserContext,
    resource: ResourceContext,
    action: ActionType | string,
    roles: Set<string>,
    req: Request
  ): boolean {
    return (
      this.matchRole(rule.roles, roles) &&
      this.matchAction(rule.actions, action) &&
      this.matchResource(rule.resources, resource) &&
      this.evaluateTimeWindow(rule.timeWindow) &&
      this.evaluateEnvironment(rule.environmentRestrictions, user, req) &&
      this.evaluateConditions(rule.conditions, user, resource)
    );
  }

  private matchRole(ruleRoles: string[], userRoles: Set<string>): boolean {
    if (ruleRoles.includes('*')) {
      return true;
    }
    for (let i = 0; i < ruleRoles.length; i++) {
      if (userRoles.has(ruleRoles[i])) {
        return true;
      }
    }
    return false;
  }

  private matchAction(ruleActions: (ActionType | string)[], requestAction: ActionType | string): boolean {
    for (let i = 0; i < ruleActions.length; i++) {
      const act = ruleActions[i];
      if (act === '*' || act === ActionType.MANAGE) {
        return true;
      }
      if (act.toUpperCase() === requestAction.toUpperCase()) {
        return true;
      }
    }
    return false;
  }

  private matchResource(ruleResources: string[], resource: ResourceContext): boolean {
    for (let i = 0; i < ruleResources.length; i++) {
      const pattern = ruleResources[i];
      if (pattern === '*') {
        return true;
      }
      if (this.globMatch(pattern, resource.path) || this.globMatch(pattern, `${resource.type}/${resource.id}`)) {
        return true;
      }
    }
    return false;
  }

  private globMatch(pattern: string, target: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(target);
  }

  private evaluateTimeWindow(window?: PolicyRule['timeWindow']): boolean {
    if (!window) {
      return true;
    }

    const now = new Date();
    if (!this.isDayOfWeekAllowed(window.allowedDaysOfWeek, now.getUTCDay())) {
      return false;
    }

    return this.isHourWindowAllowed(window.startHourUTC, window.endHourUTC, now.getUTCHours());
  }

  private isDayOfWeekAllowed(allowedDays: number[] | undefined, currentDay: number): boolean {
    if (!allowedDays || allowedDays.length === 0) {
      return true;
    }
    return allowedDays.includes(currentDay);
  }

  private isHourWindowAllowed(startHourUTC: number | undefined, endHourUTC: number | undefined, currentHour: number): boolean {
    if (startHourUTC === undefined || endHourUTC === undefined) {
      return true;
    }
    if (startHourUTC <= endHourUTC) {
      return currentHour >= startHourUTC && currentHour < endHourUTC;
    }
    return currentHour >= startHourUTC || currentHour < endHourUTC;
  }

  private evaluateEnvironment(
    env: PolicyRule['environmentRestrictions'],
    user: UserContext,
    req: Request
  ): boolean {
    if (!env) {
      return true;
    }
    if (env.disallowMaintenanceWindow && this.isSystemInMaintenance) {
      return false;
    }
    if (!this.isCountryAllowed(env.allowedCountries, user.geoCountry)) {
      return false;
    }
    if (!this.isIpAllowed(env.allowedIPRanges, user.ipAddress)) {
      return false;
    }
    return true;
  }

  private isCountryAllowed(allowedCountries: string[] | undefined, geoCountry: string | undefined): boolean {
    if (!allowedCountries || allowedCountries.length === 0) {
      return true;
    }
    if (!geoCountry) {
      return false;
    }
    return allowedCountries.includes(geoCountry.toUpperCase());
  }

  private isIpAllowed(allowedIPRanges: string[] | undefined, ipAddress: string): boolean {
    if (!allowedIPRanges || allowedIPRanges.length === 0) {
      return true;
    }
    for (let i = 0; i < allowedIPRanges.length; i++) {
      if (this.isIPInCIDR(ipAddress, allowedIPRanges[i])) {
        return true;
      }
    }
    return false;
  }

  private evaluateConditions(
    conditions: PolicyCondition[] | undefined,
    user: UserContext,
    resource: ResourceContext
  ): boolean {
    if (!conditions || conditions.length === 0) {
      return true;
    }

    for (let i = 0; i < conditions.length; i++) {
      if (!this.evaluateSingleCondition(conditions[i], user, resource)) {
        return false;
      }
    }

    return true;
  }

  private resolveRightValue(value: any, user: UserContext, resource: ResourceContext): any {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const path = value.substring(2, value.length - 1);
      return this.resolveValuePath(path, user, resource);
    }
    return value;
  }

  private evaluateSingleCondition(cond: PolicyCondition, user: UserContext, resource: ResourceContext): boolean {
    const leftValue = this.resolveValuePath(cond.field, user, resource);
    const rightValue = this.resolveRightValue(cond.value, user, resource);
    const handler = OPERATOR_STRATEGIES[cond.operator];
    if (!handler) {
      return false;
    }
    return handler(leftValue, rightValue, this);
  }

  private resolveValuePath(path: string, user: UserContext, resource: ResourceContext): any {
    const parts = path.split('.');
    let current: any = null;

    if (parts[0] === 'user') {
      current = user;
    } else if (parts[0] === 'resource') {
      current = resource;
    } else {
      return undefined;
    }

    for (let i = 1; i < parts.length; i++) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[parts[i]];
    }

    return current;
  }

  private isIPInCIDR(ip: string, cidr: string): boolean {
    if (!cidr.includes('/')) {
      return ip === cidr;
    }

    const [range, bits] = cidr.split('/');
    const mask = ~(Math.pow(2, 32 - parseInt(bits, 10)) - 1);

    const ipToLong = (ipAddr: string): number => {
      const components = ipAddr.split('.');
      if (components.length !== 4) return 0;
      return (
        ((parseInt(components[0], 10) << 24) >>> 0) +
        ((parseInt(components[1], 10) << 16) >>> 0) +
        ((parseInt(components[2], 10) << 8) >>> 0) +
        (parseInt(components[3], 10) >>> 0)
      );
    };

    return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
  }
}